// Command singlecommit runs the singlecommit analyzer; see that package.
package main

import (
	"golang.org/x/tools/go/analysis/singlechecker"

	"backend/internal/singlecommit"
)

func main() { singlechecker.Main(singlecommit.Analyzer) }
