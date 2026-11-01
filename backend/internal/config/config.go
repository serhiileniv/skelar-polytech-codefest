// Package config reads all settings from environment variables. See backend/.env.example.
package config

import (
	"errors"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	DatabaseURL     string
	HTTPAddr        string
	FrontendOrigins []string // CORS allow-list, from comma-separated FRONTEND_ORIGIN
	GroqAPIKey      string
	GroqModel       string
	GroqBaseURL     string
	Replay          bool          // VERDICT_REPLAY=1 forces recordings even with a key
	Record          bool          // VERDICT_RECORD=1 saves successful live runs to ReplayDir
	ReplayDir       string        // VERDICT_REPLAY_DIR, default "replay"
	ReplayDelay     time.Duration // VERDICT_REPLAY_DELAY_MS between replayed turns, default 600
	LogLevel        slog.Level
}

func Load() (Config, error) {
	c := Config{
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		HTTPAddr:        env("HTTP_ADDR", ":8080"),
		FrontendOrigins: list(env("FRONTEND_ORIGIN", "http://localhost:3000,http://127.0.0.1:3000")),
		GroqAPIKey:      strings.TrimSpace(os.Getenv("GROQ_API_KEY")),
		GroqModel:       env("GROQ_MODEL", "openai/gpt-oss-120b"),
		GroqBaseURL:     env("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
		Replay:          os.Getenv("VERDICT_REPLAY") == "1",
		Record:          os.Getenv("VERDICT_RECORD") == "1",
		ReplayDir:       env("VERDICT_REPLAY_DIR", "replay"),
	}
	delay, err := strconv.Atoi(env("VERDICT_REPLAY_DELAY_MS", "600"))
	if err != nil || delay < 0 {
		return c, errors.New("VERDICT_REPLAY_DELAY_MS must be a non-negative integer")
	}
	c.ReplayDelay = time.Duration(delay) * time.Millisecond
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
