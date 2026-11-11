package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func ResolveTarget(argument string) (string, error) {
	raw := strings.TrimSpace(strings.Trim(argument, `"`))
	if raw == "" {
		return "", errors.New("empty document target")
	}
	absolute, err := filepath.Abs(filepath.FromSlash(raw))
	if err != nil {
		return "", fmt.Errorf("resolve absolute path: %w", err)
	}
	canonical, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", fmt.Errorf("resolve document path: %w", err)
	}
	info, err := os.Stat(canonical)
	if err != nil {
		return "", fmt.Errorf("inspect document: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("document target must be a regular file")
	}
	if info.Size() <= 0 || info.Size() > maxDocumentBytes {
		return "", fmt.Errorf("document size must be between 1 byte and %d GiB", maxDocumentBytes>>30)
	}
	if !strings.EqualFold(filepath.Ext(canonical), ".epub") {
		return "", errors.New("epub.ts only opens EPUB files")
	}
	return canonical, nil
}
