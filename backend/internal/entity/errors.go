package entity

import (
	"errors"
	"fmt"
)

// Error kinds. The controller maps them to ApiError codes (docs/api.md → Errors).
var (
	ErrBadRequest     = errors.New("bad_request")
	ErrNotFound       = errors.New("not_found")
	ErrConflict       = errors.New("conflict")
	ErrLLMUnavailable = errors.New("llm_unavailable")
)

// Error is a domain error whose Error() text is safe to show in a toast; errors.Is matches its Kind.
type Error struct {
	Kind error
	Msg  string
}

func (e *Error) Error() string { return e.Msg }
func (e *Error) Unwrap() error { return e.Kind }

// Fail builds a domain error of the given kind, e.g. Fail(ErrNotFound, "Case %s not found.", id).
func Fail(kind error, format string, args ...any) error {
	return &Error{Kind: kind, Msg: fmt.Sprintf(format, args...)}
}
