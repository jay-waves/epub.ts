package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAIConfigClearKeyAndRequestOptions(t *testing.T) {
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
		_, _ = response.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"你好"}}]}`))
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

	clearResponse := httptest.NewRecorder()
	app.handleAIConfig(clearResponse, httptest.NewRequest(http.MethodPut, "/api/control/ai-config", strings.NewReader(`{"apiKey":""}`)))
	if clearResponse.Code != http.StatusNoContent || currentAIConfig().APIKey != "" {
		t.Fatalf("key clear status = %d, key remains = %t", clearResponse.Code, currentAIConfig().APIKey != "")
	}
}
