package common

import "unicode/utf8"

type PageSize int32
type PaginationKey string

func IsPageSize(value PageSize) bool {
	return value >= 1 && value <= 100
}

func IsPaginationKey(value PaginationKey) bool {
	length := utf8.RuneCountInString(string(value))
	return length >= 1 && length <= 4096
}
