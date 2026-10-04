// Package singlecommit reports HTTP handlers that can commit more than one
// database transaction, so a request's writes land atomically or not at all.
// Functions in every package are summarized, so a handler is charged for the
// commits of whatever it calls; only packages under handlers/ are reported,
// since background work commits once per item by design.
//
// A commit point is a transaction begun on a pool or connection, a write
// query run through sqlc Queries that are not bound to a transaction (each
// such statement commits on its own), or a call to a function that has
// commit points. Writes through a *sqlc.Queries parameter are charged to the
// caller that supplies it. A function literal passed to a call or invoked
// in place counts where it appears, and its parameters are treated as
// transaction-bound because the code invoking it, such as idempotency.Run,
// supplies them. Any other function literal, such as a returned HTTP
// handler, is checked on its own. Calls through interfaces and function
// values are not followed.
//
// A rare function that must commit more than once states why in its doc
// comment:
//
//	//vetchium:multiple-commits <reason>
//
// Its callers then count it as one commit point, and on a handler
// constructor it also covers the handler literal the constructor returns.
package singlecommit

import (
	"fmt"
	"go/ast"
	"go/constant"
	"go/token"
	"go/types"
	"maps"
	"regexp"
	"slices"
	"strings"

	"golang.org/x/tools/go/analysis"
	"golang.org/x/tools/go/types/typeutil"
)

const directive = "//vetchium:multiple-commits"

var Analyzer = &analysis.Analyzer{
	Name: "singlecommit",
	Doc: "report HTTP handlers that can commit more than one database " +
		"transaction",
	Run:       run,
	FactTypes: []analysis.Fact{new(writeQuery), new(commits)},
}

// writeQuery marks a generated sqlc method whose statement modifies data.
type writeQuery struct{}

func (*writeQuery) AFact()         {}
func (*writeQuery) String() string { return "writeQuery" }

// commits summarizes a function for its callers.
type commits struct {
	// Units is the most commit points on one path, capped at many.
	Units int
	// ParamWrites maps a *sqlc.Queries parameter index to the most writes
	// through it on one path; the caller decides whether they commit.
	ParamWrites map[int]int
}

func (*commits) AFact() {}

func (c *commits) String() string {
	text := fmt.Sprintf("commits %d", c.Units)
	for _, index := range slices.Sorted(maps.Keys(c.ParamWrites)) {
		text += fmt.Sprintf(" param%d=%d", index, c.ParamWrites[index])
	}
	return text
}

const many = 2

func run(pass *analysis.Pass) (any, error) {
	if isSQLCPackage(pass.Pkg) {
		exportWriteQueries(pass)
		return nil, nil
	}
	a := &analyzer{
		pass:      pass,
		summaries: map[*types.Func]*commits{},
	}
	var decls []*ast.FuncDecl
	for _, file := range pass.Files {
		for _, decl := range file.Decls {
			if fn, ok := decl.(*ast.FuncDecl); ok && fn.Body != nil {
				decls = append(decls, fn)
			}
		}
	}
	// Functions in one package may call each other in any order; summaries
	// only grow and are capped, so this converges.
	for changed := true; changed; {
		changed = false
		for _, decl := range decls {
			fn, _ := pass.TypesInfo.Defs[decl.Name].(*types.Func)
			if fn == nil {
				continue
			}
			result := a.function(decl)
			fact := result.summary.fact()
			if hasDirective(decl) {
				fact.Units = min(fact.Units, 1)
			}
			if previous := a.summaries[fn]; previous == nil ||
				!previous.equal(fact) {
				a.summaries[fn] = fact
				changed = true
			}
		}
	}
	reported := strings.Contains(pass.Pkg.Path()+"/", "/handlers/")
	for _, decl := range decls {
		fn, _ := pass.TypesInfo.Defs[decl.Name].(*types.Func)
		if fn == nil {
			continue
		}
		fact := a.summaries[fn]
		if fact.Units > 0 || len(fact.ParamWrites) > 0 {
			pass.ExportObjectFact(fn, fact)
		}
		if !reported {
			continue
		}
		file := pass.Fset.File(decl.Pos())
		if file == nil || strings.HasSuffix(file.Name(), "_test.go") {
			continue
		}
		if hasDirective(decl) {
			if directiveReason(decl) == "" {
				pass.Reportf(decl.Name.Pos(),
					"%s needs a reason after %s", decl.Name.Name, directive)
			}
			continue
		}
		result := a.function(decl)
		if result.summary.units >= many {
			a.report(decl.Name.Pos(), decl.Name.Name, result.sites)
		}
		for literal, detached := range result.detached {
			if detached.summary.units >= many {
				a.report(literal.Pos(),
					"function literal in "+decl.Name.Name, detached.sites)
			}
		}
	}
	return nil, nil
}

func hasDirective(decl *ast.FuncDecl) bool {
	if decl.Doc == nil {
		return false
	}
	for _, comment := range decl.Doc.List {
		if comment.Text == directive ||
			strings.HasPrefix(comment.Text, directive+" ") {
			return true
		}
	}
	return false
}

func directiveReason(decl *ast.FuncDecl) string {
	for _, comment := range decl.Doc.List {
		if reason, ok := strings.CutPrefix(comment.Text, directive); ok {
			return strings.TrimSpace(reason)
		}
	}
	return ""
}

// The sqlc packages are the generated database access packages whose
// Queries methods run one statement each.
func isSQLCPackage(pkg *types.Package) bool {
	return pkg.Name() == "sqlc" && strings.HasSuffix(pkg.Path(), "/sqlc")
}

func isQueries(t types.Type) bool {
	pointer, ok := t.(*types.Pointer)
	if !ok {
		return false
	}
	named, ok := pointer.Elem().(*types.Named)
	if !ok {
		return false
	}
	object := named.Obj()
	return object.Name() == "Queries" && object.Pkg() != nil &&
		isSQLCPackage(object.Pkg())
}

var (
	sqlComment     = regexp.MustCompile(`--[^\n]*`)
	sqlString      = regexp.MustCompile(`'[^']*'`)
	sqlLockOrMerge = regexp.MustCompile(
		`(?i)\bFOR\s+(NO\s+KEY\s+)?UPDATE\b|\bDO\s+UPDATE\b`)
	sqlWrite = regexp.MustCompile(
		`(?i)\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b`)
)

// writesData reports whether a statement inserts, updates, or deletes rows.
// Row locks and ON CONFLICT DO UPDATE are not writes by themselves.
func writesData(sql string) bool {
	sql = sqlComment.ReplaceAllString(sql, "")
	sql = sqlString.ReplaceAllString(sql, "''")
	sql = sqlLockOrMerge.ReplaceAllString(sql, "")
	return sqlWrite.MatchString(sql)
}

func exportWriteQueries(pass *analysis.Pass) {
	for _, file := range pass.Files {
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Recv == nil || fn.Body == nil {
				continue
			}
			object, _ := pass.TypesInfo.Defs[fn.Name].(*types.Func)
			if object == nil {
				continue
			}
			ast.Inspect(fn.Body, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok || len(call.Args) < 2 {
					return true
				}
				value := pass.TypesInfo.Types[call.Args[1]].Value
				if value == nil || value.Kind() != constant.String {
					return true
				}
				if writesData(constant.StringVal(value)) {
					pass.ExportObjectFact(object, new(writeQuery))
					return false
				}
				return true
			})
		}
	}
}

// summary counts commit points on the worst path through a region of code.
type summary struct {
	units  int
	params map[int]int
}

func (s summary) fact() *commits {
	fact := &commits{Units: s.units}
	if len(s.params) > 0 {
		fact.ParamWrites = map[int]int{}
		for index, writes := range s.params {
			fact.ParamWrites[index] = writes
		}
	}
	return fact
}

func (c *commits) equal(other *commits) bool {
	if c.Units != other.Units || len(c.ParamWrites) != len(other.ParamWrites) {
		return false
	}
	for index, writes := range c.ParamWrites {
		if other.ParamWrites[index] != writes {
			return false
		}
	}
	return true
}

func plus(a, b summary) summary {
	result := summary{units: min(a.units+b.units, many)}
	for _, source := range []map[int]int{a.params, b.params} {
		for index, writes := range source {
			if result.params == nil {
				result.params = map[int]int{}
			}
			result.params[index] = min(result.params[index]+writes, many)
		}
	}
	return result
}

func larger(a, b summary) summary {
	result := summary{units: max(a.units, b.units)}
	for _, source := range []map[int]int{a.params, b.params} {
		for index, writes := range source {
			if result.params == nil {
				result.params = map[int]int{}
			}
			result.params[index] = max(result.params[index], writes)
		}
	}
	return result
}

func (s summary) any() bool { return s.units > 0 || len(s.params) > 0 }

func (s summary) repeated() summary {
	result := summary{}
	if s.units > 0 {
		result.units = many
	}
	for index, writes := range s.params {
		if writes > 0 {
			if result.params == nil {
				result.params = map[int]int{}
			}
			result.params[index] = many
		}
	}
	return result
}

// flow describes a region of code: the worst path that continues after it,
// if any can, and the worst path that leaves the function inside it, if any
// does.
type flow struct {
	fall, exit       summary
	falls, exits     bool
	sitesWithinRange []token.Pos
}

func through(s summary) flow { return flow{fall: s, falls: true} }

// then sequences two regions; nothing after a region that cannot fall
// through runs.
func then(a, b flow) flow {
	if !a.falls {
		return a
	}
	result := flow{
		exit:  a.exit,
		exits: a.exits,
	}
	if b.exits {
		exit := plus(a.fall, b.exit)
		if result.exits {
			exit = larger(result.exit, exit)
		}
		result.exit, result.exits = exit, true
	}
	if b.falls {
		result.fall, result.falls = plus(a.fall, b.fall), true
	}
	result.sitesWithinRange = append(
		slices.Clone(a.sitesWithinRange), b.sitesWithinRange...)
	return result
}

// either joins alternative regions.
func either(alternatives ...flow) flow {
	var result flow
	for _, alternative := range alternatives {
		if alternative.falls {
			if result.falls {
				result.fall = larger(result.fall, alternative.fall)
			} else {
				result.fall, result.falls = alternative.fall, true
			}
		}
		if alternative.exits {
			if result.exits {
				result.exit = larger(result.exit, alternative.exit)
			} else {
				result.exit, result.exits = alternative.exit, true
			}
		}
		result.sitesWithinRange = append(
			result.sitesWithinRange, alternative.sitesWithinRange...)
	}
	return result
}

type binding int

const (
	poolBound binding = iota
	txBound
	paramBound
)

type queriesSource struct {
	binding binding
	param   int
}

type analyzer struct {
	pass      *analysis.Pass
	summaries map[*types.Func]*commits
}

// scope holds what one function declaration knows about its Queries values.
type scope struct {
	params   map[types.Object]int
	literals map[types.Object]bool
	locals   map[types.Object]queriesSource
	// inline holds the function literals that run where they appear.
	inline map[*ast.FuncLit]bool
	// detached holds the other function literals, checked on their own.
	detached []*ast.FuncLit
}

type functionResult struct {
	summary summary
	sites   []token.Pos
	// detached holds each separately checked function literal's result.
	detached map[*ast.FuncLit]functionResult
}

func (a *analyzer) function(decl *ast.FuncDecl) functionResult {
	sc := &scope{
		params:   map[types.Object]int{},
		literals: map[types.Object]bool{},
		locals:   map[types.Object]queriesSource{},
		inline:   map[*ast.FuncLit]bool{},
	}
	index := 0
	for _, field := range decl.Type.Params.List {
		if len(field.Names) == 0 {
			index++
			continue
		}
		for _, name := range field.Names {
			if object := a.pass.TypesInfo.Defs[name]; object != nil {
				sc.params[object] = index
			}
			index++
		}
	}
	ast.Inspect(decl.Body, func(node ast.Node) bool {
		literal, ok := node.(*ast.FuncLit)
		if !ok {
			return true
		}
		for _, field := range literal.Type.Params.List {
			for _, name := range field.Names {
				if object := a.pass.TypesInfo.Defs[name]; object != nil {
					sc.literals[object] = true
				}
			}
		}
		return true
	})
	started := map[*ast.CallExpr]bool{}
	ast.Inspect(decl.Body, func(node ast.Node) bool {
		switch node := node.(type) {
		case *ast.GoStmt:
			started[node.Call] = true
		case *ast.CallExpr:
			if started[node] {
				return true
			}
			if literal, ok := ast.Unparen(node.Fun).(*ast.FuncLit); ok {
				sc.inline[literal] = true
			}
			if a.pass.TypesInfo.Types[node.Fun].IsType() {
				return true
			}
			for _, argument := range node.Args {
				if literal, ok := ast.Unparen(argument).(*ast.FuncLit); ok {
					sc.inline[literal] = true
				}
			}
		case *ast.FuncLit:
			if !sc.inline[node] {
				sc.detached = append(sc.detached, node)
			}
		}
		return true
	})
	a.recordLocals(decl.Body, sc)
	body := a.block(decl.Body.List, sc)
	result := functionResult{
		summary:  total(body),
		sites:    body.sitesWithinRange,
		detached: map[*ast.FuncLit]functionResult{},
	}
	for _, literal := range sc.detached {
		body := a.block(literal.Body.List, sc)
		result.detached[literal] = functionResult{
			summary: total(body), sites: body.sitesWithinRange,
		}
	}
	return result
}

func total(region flow) summary {
	if region.exits {
		return larger(region.fall, region.exit)
	}
	return region.fall
}

func (a *analyzer) recordLocals(body *ast.BlockStmt, sc *scope) {
	assign := func(name *ast.Ident, value ast.Expr) {
		object := a.pass.TypesInfo.ObjectOf(name)
		if object == nil || !isQueries(object.Type()) {
			return
		}
		source := a.source(value, sc)
		if previous, ok := sc.locals[object]; ok && previous != source {
			source = queriesSource{binding: poolBound}
		}
		sc.locals[object] = source
	}
	ast.Inspect(body, func(node ast.Node) bool {
		switch node := node.(type) {
		case *ast.AssignStmt:
			if len(node.Lhs) != len(node.Rhs) {
				return true
			}
			for i, target := range node.Lhs {
				if name, ok := target.(*ast.Ident); ok {
					assign(name, node.Rhs[i])
				}
			}
		case *ast.ValueSpec:
			if len(node.Names) != len(node.Values) {
				return true
			}
			for i, name := range node.Names {
				assign(name, node.Values[i])
			}
		}
		return true
	})
}

func (a *analyzer) source(expression ast.Expr, sc *scope) queriesSource {
	switch expression := ast.Unparen(expression).(type) {
	case *ast.Ident:
		object := a.pass.TypesInfo.ObjectOf(expression)
		if index, ok := sc.params[object]; ok {
			return queriesSource{binding: paramBound, param: index}
		}
		if sc.literals[object] {
			return queriesSource{binding: txBound}
		}
		if source, ok := sc.locals[object]; ok {
			return source
		}
	case *ast.CallExpr:
		callee := typeutil.StaticCallee(a.pass.TypesInfo, expression)
		if callee == nil || callee.Pkg() == nil ||
			!isSQLCPackage(callee.Pkg()) {
			break
		}
		switch callee.Name() {
		case "New":
			if len(expression.Args) == 1 &&
				isTransaction(a.pass.TypesInfo.TypeOf(expression.Args[0])) {
				return queriesSource{binding: txBound}
			}
		case "WithTx":
			return queriesSource{binding: txBound}
		}
	}
	return queriesSource{binding: poolBound}
}

// A transaction has Commit and Rollback; beginning on one opens a savepoint.
func isTransaction(t types.Type) bool {
	if t == nil {
		return false
	}
	methods := types.NewMethodSet(t)
	return methods.Lookup(nil, "Commit") != nil &&
		methods.Lookup(nil, "Rollback") != nil
}

func (a *analyzer) block(statements []ast.Stmt, sc *scope) flow {
	result := through(summary{})
	for _, statement := range statements {
		result = then(result, a.statement(statement, sc))
		if !result.falls {
			break
		}
	}
	return result
}

func (a *analyzer) statement(statement ast.Stmt, sc *scope) flow {
	switch statement := statement.(type) {
	case *ast.BlockStmt:
		return a.block(statement.List, sc)
	case *ast.LabeledStmt:
		return a.statement(statement.Stmt, sc)
	case *ast.GoStmt:
		// A goroutine's work is its own unit, checked where it is declared.
		return through(summary{})
	case *ast.ReturnStmt:
		result := a.expressions(statement, sc)
		return flow{
			exit:             result.fall,
			exits:            true,
			sitesWithinRange: result.sitesWithinRange,
		}
	case *ast.ExprStmt:
		result := a.expressions(statement, sc)
		if isTerminatingCall(a.pass.TypesInfo, statement.X) {
			return flow{
				exit:             result.fall,
				exits:            true,
				sitesWithinRange: result.sitesWithinRange,
			}
		}
		return result
	case *ast.IfStmt:
		head := then(a.optional(statement.Init, sc),
			a.expressions(statement.Cond, sc))
		alternative := through(summary{})
		if statement.Else != nil {
			alternative = a.statement(statement.Else, sc)
		}
		return then(head, either(a.block(statement.Body.List, sc),
			alternative))
	case *ast.SwitchStmt:
		head := a.optional(statement.Init, sc)
		if statement.Tag != nil {
			head = then(head, a.expressions(statement.Tag, sc))
		}
		return then(head, a.clauses(statement.Body, sc))
	case *ast.TypeSwitchStmt:
		head := then(a.optional(statement.Init, sc),
			a.expressions(statement.Assign, sc))
		return then(head, a.clauses(statement.Body, sc))
	case *ast.SelectStmt:
		return a.clauses(statement.Body, sc)
	case *ast.ForStmt:
		head := then(a.optional(statement.Init, sc),
			a.optional(statement.Cond, sc))
		body := then(a.block(statement.Body.List, sc),
			a.optional(statement.Post, sc))
		return then(head, repeat(body))
	case *ast.RangeStmt:
		head := a.expressions(statement.X, sc)
		return then(head, repeat(a.block(statement.Body.List, sc)))
	default:
		return a.expressions(statement, sc)
	}
}

// repeat models a loop body that can run any number of times, or not at all.
func repeat(body flow) flow {
	worst := body.fall
	if body.exits {
		worst = larger(worst, body.exit)
	}
	if !worst.any() {
		return through(summary{})
	}
	repeated := worst.repeated()
	return flow{
		fall:             repeated,
		falls:            true,
		exit:             repeated,
		exits:            body.exits,
		sitesWithinRange: body.sitesWithinRange,
	}
}

func (a *analyzer) clauses(body *ast.BlockStmt, sc *scope) flow {
	var alternatives []flow
	exhaustive := false
	for _, clause := range body.List {
		switch clause := clause.(type) {
		case *ast.CaseClause:
			if clause.List == nil {
				exhaustive = true
			}
			head := through(summary{})
			for _, expression := range clause.List {
				head = then(head, a.expressions(expression, sc))
			}
			alternatives = append(alternatives,
				then(head, a.block(clause.Body, sc)))
		case *ast.CommClause:
			if clause.Comm == nil {
				exhaustive = true
			}
			alternatives = append(alternatives, then(
				a.optional(clause.Comm, sc), a.block(clause.Body, sc)))
		}
	}
	if !exhaustive {
		alternatives = append(alternatives, through(summary{}))
	}
	return either(alternatives...)
}

func (a *analyzer) optional(node ast.Node, sc *scope) flow {
	if node == nil {
		return through(summary{})
	}
	if statement, ok := node.(ast.Stmt); ok {
		return a.statement(statement, sc)
	}
	return a.expressions(node, sc)
}

// expressions counts the commit points of every call in a node, in order,
// including the bodies of function literals defined there.
func (a *analyzer) expressions(node ast.Node, sc *scope) flow {
	result := through(summary{})
	if node == nil {
		return result
	}
	ast.Inspect(node, func(child ast.Node) bool {
		switch child := child.(type) {
		case *ast.FuncLit:
			if !sc.inline[child] {
				return false
			}
			body := a.block(child.Body.List, sc)
			result = then(result, flow{
				fall: total(body), falls: true,
				sitesWithinRange: body.sitesWithinRange,
			})
			return false
		case *ast.CallExpr:
			if cost := a.call(child, sc); cost.any() {
				result = then(result, flow{
					fall: cost, falls: true,
					sitesWithinRange: []token.Pos{child.Pos()},
				})
			}
		}
		return true
	})
	return result
}

func (a *analyzer) call(call *ast.CallExpr, sc *scope) summary {
	selector, _ := ast.Unparen(call.Fun).(*ast.SelectorExpr)
	if selector != nil {
		if receiver := a.pass.TypesInfo.TypeOf(selector.X); receiver != nil {
			name := selector.Sel.Name
			if (name == "Begin" || name == "BeginTx") &&
				!isTransaction(receiver) && returnsTransaction(
				a.pass.TypesInfo.TypeOf(call)) {
				return summary{units: 1}
			}
		}
	}
	callee := typeutil.StaticCallee(a.pass.TypesInfo, call)
	if callee == nil {
		if selector != nil && a.interfaceWrite(selector) {
			return a.charge(a.source(selector.X, sc), 1)
		}
		return summary{}
	}
	callee = callee.Origin()
	if callee.Pkg() != nil && isSQLCPackage(callee.Pkg()) {
		if selector == nil || !a.pass.ImportObjectFact(callee,
			new(writeQuery)) {
			return summary{}
		}
		return a.charge(a.source(selector.X, sc), 1)
	}
	fact := a.summaries[callee]
	if fact == nil {
		imported := new(commits)
		if !a.pass.ImportObjectFact(callee, imported) {
			return summary{}
		}
		fact = imported
	}
	result := summary{units: fact.Units}
	for index, writes := range fact.ParamWrites {
		if index < len(call.Args) {
			result = plus(result, a.charge(
				a.source(call.Args[index], sc), writes))
		}
	}
	return result
}

// interfaceWrite reports whether a call through an interface names a method
// that the sqlc Queries this package imports implement as a write, so narrow
// interfaces over Queries are checked like Queries.
func (a *analyzer) interfaceWrite(selector *ast.SelectorExpr) bool {
	selection := a.pass.TypesInfo.Selections[selector]
	if selection == nil || selection.Kind() != types.MethodVal ||
		!types.IsInterface(selection.Recv()) {
		return false
	}
	method, ok := selection.Obj().(*types.Func)
	if !ok {
		return false
	}
	for _, imported := range a.pass.Pkg.Imports() {
		if !isSQLCPackage(imported) {
			continue
		}
		queries, ok := imported.Scope().Lookup("Queries").(*types.TypeName)
		if !ok {
			continue
		}
		object, _, _ := types.LookupFieldOrMethod(
			types.NewPointer(queries.Type()), true, imported, method.Name())
		implementation, ok := object.(*types.Func)
		if !ok || !types.Identical(
			implementation.Signature().Params(), method.Signature().Params(),
		) {
			continue
		}
		if a.pass.ImportObjectFact(implementation, new(writeQuery)) {
			return true
		}
	}
	return false
}

// charge attributes writes through Queries from source: they commit on
// their own through a pool, ride the caller's transaction through a
// parameter, and cost nothing inside a transaction.
func (a *analyzer) charge(source queriesSource, writes int) summary {
	switch source.binding {
	case txBound:
		return summary{}
	case paramBound:
		return summary{params: map[int]int{source.param: writes}}
	default:
		return summary{units: min(writes, many)}
	}
}

func returnsTransaction(t types.Type) bool {
	tuple, ok := t.(*types.Tuple)
	return ok && tuple.Len() == 2 && isTransaction(tuple.At(0).Type())
}

func isTerminatingCall(info *types.Info, expression ast.Expr) bool {
	call, ok := ast.Unparen(expression).(*ast.CallExpr)
	if !ok {
		return false
	}
	if name, ok := ast.Unparen(call.Fun).(*ast.Ident); ok {
		if builtin, ok := info.Uses[name].(*types.Builtin); ok {
			return builtin.Name() == "panic"
		}
	}
	return false
}

func (a *analyzer) report(position token.Pos, name string, sites []token.Pos) {
	a.pass.Reportf(position,
		"%s can commit more than one transaction (commit points at %s); "+
			"do all writes in one transaction, or explain the exception "+
			"with %s <reason>",
		name, a.positions(sites), directive)
}

func (a *analyzer) positions(sites []token.Pos) string {
	var lines []string
	seen := map[string]bool{}
	for _, site := range sites {
		position := a.pass.Fset.Position(site)
		label := position.String()
		if file := position.Filename; file != "" {
			if index := strings.LastIndex(file, "/"); index >= 0 {
				label = strings.TrimPrefix(label, file[:index+1])
			}
		}
		if !seen[label] {
			seen[label] = true
			lines = append(lines, label)
		}
	}
	return strings.Join(lines, ", ")
}
