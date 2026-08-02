package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const maxDocumentBytes int64 = 4 << 30

var errPreconditionRequired = errors.New("If-Match is required for document writes")

type Resource struct {
	path    string
	mutex   sync.RWMutex
	version string
	size    int64
	modTime time.Time
}

type WriteResult struct {
	Version string `json:"version"`
	Name    string `json:"name"`
}

type Conflict struct {
	Code           string `json:"code"`
	Message        string `json:"message"`
	CurrentVersion string `json:"currentVersion"`
}

type CopyResult struct {
	Name string `json:"name"`
}

func NewResource(path string) (*Resource, error) {
	version, err := fileVersion(path)
	if err != nil {
		return nil, fmt.Errorf("fingerprint document: %w", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("inspect document: %w", err)
	}
	return &Resource{
		path:    path,
		version: version,
		size:    info.Size(),
		modTime: info.ModTime(),
	}, nil
}

func (resource *Resource) Path() string { return resource.path }

func (resource *Resource) Serve(response http.ResponseWriter, request *http.Request) error {
	file, err := os.Open(resource.path)
	if err != nil {
		return fmt.Errorf("open document: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("inspect document: %w", err)
	}
	version, err := resource.versionFor(file, info)
	if err != nil {
		return err
	}

	response.Header().Set("ETag", quoteETag(version))
	response.Header().Set("Content-Disposition", contentDisposition(filepath.Base(resource.path)))
	http.ServeContent(response, request, filepath.Base(resource.path), info.ModTime(), file)
	return nil
}

func fileVersion(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	return fileVersionFrom(file)
}

func fileVersionFrom(reader io.Reader) (string, error) {
	hash := sha256.New()
	if _, err := io.Copy(hash, reader); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func (resource *Resource) versionFor(file *os.File, info os.FileInfo) (string, error) {
	resource.mutex.RLock()
	if resource.size == info.Size() && resource.modTime.Equal(info.ModTime()) {
		version := resource.version
		resource.mutex.RUnlock()
		return version, nil
	}
	resource.mutex.RUnlock()

	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", fmt.Errorf("rewind document before fingerprint: %w", err)
	}
	version, err := fileVersionFrom(file)
	if err != nil {
		return "", fmt.Errorf("fingerprint changed document: %w", err)
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", fmt.Errorf("rewind document after fingerprint: %w", err)
	}
	resource.mutex.Lock()
	resource.version = version
	resource.size = info.Size()
	resource.modTime = info.ModTime()
	resource.mutex.Unlock()
	return version, nil
}

func quoteETag(value string) string {
	return `"` + value + `"`
}

func unquoteETag(value string) string {
	return strings.Trim(strings.TrimSpace(value), `"`)
}

func contentDisposition(filename string) string {
	var fallback strings.Builder
	for _, character := range filename {
		if character >= 0x20 && character <= 0x7e && character != '"' && character != '\\' {
			fallback.WriteRune(character)
		} else {
			fallback.WriteByte('_')
		}
	}
	return fmt.Sprintf(
		`inline; filename="%s"; filename*=UTF-8''%s`,
		fallback.String(),
		encodeRFC5987(filename),
	)
}

func encodeRFC5987(value string) string {
	const hexadecimal = "0123456789ABCDEF"
	var encoded strings.Builder
	for index := 0; index < len(value); index++ {
		character := value[index]
		if character >= 'a' && character <= 'z' ||
			character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' ||
			strings.ContainsRune("!#$&+-.^_`|~", rune(character)) {
			encoded.WriteByte(character)
			continue
		}
		encoded.WriteByte('%')
		encoded.WriteByte(hexadecimal[character>>4])
		encoded.WriteByte(hexadecimal[character&0x0f])
	}
	return encoded.String()
}
