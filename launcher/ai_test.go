package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAIConfigResetKeyAndRequestOptions(t *testing.T) {
	desktopAIConfigMutex.Lock()
	previous := desktopAIConfig
	desktopAIConfigMutex.Unlock()
	t.Cleanup(func() {
		desktopAIConfigMutex.Lock()
		desktopAIConfig = previous
		desktopAIConfigMutex.Unlock()
	})

	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/chat/completions" {
			t.Errorf("path = %q", request.URL.Path)
		}
		var body struct {
			Model           string `json:"model"`
			ReasoningEffort string `json:"reasoning_effort"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Model != "deepseek-flash" || body.ReasoningEffort != "none" {
			t.Errorf("request = %+v", body)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"你好"}}],"usage":{"total_tokens":12}}`))
	}))
	defer upstream.Close()

	app := &App{}
	configBody := `{"apiKey":"secret","baseUrl":"` + upstream.URL + `","model":"deepseek-flash"}`
	configResponse := httptest.NewRecorder()
	app.handleAIConfig(configResponse, httptest.NewRequest(http.MethodPut, "/api/control/ai-config", strings.NewReader(configBody)))
	if configResponse.Code != http.StatusNoContent {
		t.Fatalf("config status = %d: %s", configResponse.Code, configResponse.Body.String())
	}

	aiResponse := httptest.NewRecorder()
	app.handleAI(aiResponse, httptest.NewRequest(http.MethodPost, "/api/control/ai", strings.NewReader(`{"prompt":"Translate hello"}`)))
	if aiResponse.Code != http.StatusOK {
		t.Fatalf("AI status = %d: %s", aiResponse.Code, aiResponse.Body.String())
	}
	if currentAIConfig().TotalTokens != 12 {
		t.Fatalf("total tokens = %d", currentAIConfig().TotalTokens)
	}
	tokensResponse := httptest.NewRecorder()
	app.handleAIConfig(tokensResponse, httptest.NewRequest(http.MethodPut, "/api/control/ai-config", strings.NewReader(`{"model":"another-model"}`)))
	if tokensResponse.Code != http.StatusNoContent || currentAIConfig().TotalTokens != 0 {
		t.Fatal("token count was not cleared")
	}

	clearResponse := httptest.NewRecorder()
	app.handleAIConfig(clearResponse, httptest.NewRequest(http.MethodPut, "/api/control/ai-config", strings.NewReader(`{"apiKey":""}`)))
	if clearResponse.Code != http.StatusNoContent || currentAIConfig().APIKey != "secret" {
		t.Fatal("empty key update cleared the configured key")
	}
	resetResponse := httptest.NewRecorder()
	app.handleAIConfig(resetResponse, httptest.NewRequest(http.MethodPut, "/api/control/ai-config", strings.NewReader(`{"reset":true}`)))
	if resetResponse.Code != http.StatusNoContent || currentAIConfig().APIKey != "" {
		t.Fatal("reset did not clear the configured key")
	}
}

func TestAIUsageResetRules(t *testing.T) {
	previous := currentAIConfig()
	t.Cleanup(func() { desktopAIConfigMutex.Lock(); desktopAIConfig = previous; desktopAIConfigMutex.Unlock() })
	for _, test := range []struct {
		name, body string
		want       int
		reset      bool
	}{
		{"same model", `{"model":"original"}`, 42, false},
		{"trimmed model", `{"model":" original "}`, 42, false},
		{"other setting", `{"apiKey":"new-key"}`, 42, false},
		{"changed model", `{"model":"different"}`, 0, true},
		{"reset", `{"reset":true}`, 0, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			desktopAIConfigMutex.Lock()
			desktopAIConfig = aiConfig{Model: "original", TotalTokens: 42, usageGeneration: 7}
			desktopAIConfigMutex.Unlock()
			response := httptest.NewRecorder()
			(&App{}).handleAIConfig(response, httptest.NewRequest(http.MethodPut, "/api/control/ai-config", strings.NewReader(test.body)))
			actual := currentAIConfig()
			if response.Code != http.StatusNoContent || actual.TotalTokens != test.want {
				t.Fatalf("status %d, tokens %d; want %d", response.Code, actual.TotalTokens, test.want)
			}
			if (actual.usageGeneration != 7) != test.reset {
				t.Fatal("usage generation did not match reset behavior")
			}
		})
	}
}
