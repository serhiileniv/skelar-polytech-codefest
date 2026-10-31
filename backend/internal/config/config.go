// Package config reads all settings from environment variables. See backend/.env.example.
package config

import (
	"errors"
	"log/slog"
	"os"
	"strings"
)

type Config struct {
	DatabaseURL     string
	HTTPAddr        string
	FrontendOrigins []string // CORS allow-list, from comma-separated FRONTEND_ORIGIN
	AnthropicAPIKey string
	AnthropicModel  string
	Replay          bool
	LogLevel        slog.Level
}

func Load() (Config, error) {
	c := Config{
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		HTTPAddr:        env("HTTP_ADDR", ":8080"),
		FrontendOrigins: list(env("FRONTEND_ORIGIN", "http://localhost:3000,http://127.0.0.1:3000")),
		AnthropicAPIKey: os.Getenv("ANTHROPIC_API_KEY"),
		AnthropicModel:  env("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
		Replay:          os.Getenv("VERDICT_REPLAY") == "1",
	}
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL is required (see backend/.env.example)")
	}
	if err := c.LogLevel.UnmarshalText([]byte(env("LOG_LEVEL", "info"))); err != nil {
		return c, err
	}
	return c, nil
}

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// list splits a comma-separated value, trimming spaces and trailing slashes, dropping empties.
func list(v string) []string {
	var out []string
	for _, part := range strings.Split(v, ",") {
		if part = strings.TrimRight(strings.TrimSpace(part), "/"); part != "" {
			out = append(out, part)
		}
	}
	return out
}
