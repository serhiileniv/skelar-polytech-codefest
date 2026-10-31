// Package migrations embeds the SQL files so the binary migrates itself on startup.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
