package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"

	openai "github.com/sashabaranov/go-openai"
)

type aiRequest struct {
	Prompt string `json:"prompt"`
}

type aiResponse struct {
	Text    string `json:"text,omitempty"`
	Message string `json:"message,omitempty"`
}

type aiConfig struct {
	APIKey           string `json:"-"`
	APIKeyConfigured bool   `json:"apiKeyConfigured"`
	BaseURL          string `json:"baseUrl"`
	Model            string `json:"model"`
}

type aiConfigUpdate struct {
	APIKey  *string `json:"apiKey"`
	BaseURL *string `json:"baseUrl"`
	Model   *string `json:"model"`
}

var desktopAIConfig aiConfig
var desktopAIConfigMutex sync.RWMutex

func currentAIConfig() aiConfig {
	desktopAIConfigMutex.RLock()
	defer desktopAIConfigMutex.RUnlock()
	return desktopAIConfig
}

func (app *App) handleAIConfig(response http.ResponseWriter, request *http.Request) {
	if !app.sameOrigin(request) {
		writeJSONError(response, http.StatusForbidden, "forbidden_origin", "The AI config request did not come from this epub.ts instance.")
		return
	}
	switch request.Method {
	case http.MethodGet:
		config := currentAIConfig()
		config.APIKeyConfigured = config.APIKey != ""
		writeJSON(response, http.StatusOK, config)
	case http.MethodPut:
		var input aiConfigUpdate
		if err := json.NewDecoder(http.MaxBytesReader(response, request.Body, 64<<10)).Decode(&input); err != nil {
			writeJSONError(response, http.StatusBadRequest, "invalid_ai_config", "Invalid AI config.")
			return
		}
		desktopAIConfigMutex.Lock()
		config := desktopAIConfig
		if input.APIKey != nil {
			config.APIKey = *input.APIKey
		}
		if input.BaseURL != nil {
			config.BaseURL = *input.BaseURL
		}
		if input.Model != nil {
			config.Model = *input.Model
		}
		desktopAIConfig = config
		desktopAIConfigMutex.Unlock()
		response.WriteHeader(http.StatusNoContent)
	default:
		response.Header().Set("Allow", "GET, PUT")
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
	}
}

const aiSystemPrompt = "Follow the user's reading request. Return only the requested result."

func (app *App) handleAI(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		response.Header().Set("Allow", http.MethodPost)
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !app.sameOrigin(request) {
		writeJSONError(response, http.StatusForbidden, "forbidden_origin", "The AI request did not come from this epub.ts instance.")
		return
	}
	var input aiRequest
	if err := json.NewDecoder(http.MaxBytesReader(response, request.Body, 64<<10)).Decode(&input); err != nil {
		writeJSONError(response, http.StatusBadRequest, "invalid_ai_request", "Invalid AI request.")
		return
	}
	aiConfig := currentAIConfig()
	if input.Prompt == "" || aiConfig.APIKey == "" || aiConfig.BaseURL == "" || aiConfig.Model == "" {
		writeJSONError(response, http.StatusBadRequest, "invalid_ai_request", "Text, API key, base URL, and model are required.")
		return
	}
	config := openai.DefaultConfig(aiConfig.APIKey)
	config.BaseURL = strings.TrimRight(aiConfig.BaseURL, "/")
	client := openai.NewClientWithConfig(config)
	completion, err := client.CreateChatCompletion(request.Context(), openai.ChatCompletionRequest{
		Model:           aiConfig.Model,
		Messages:        []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleSystem, Content: aiSystemPrompt}, {Role: openai.ChatMessageRoleUser, Content: input.Prompt}},
		ReasoningEffort: "none",
	})
	if err != nil {
		writeJSON(response, http.StatusBadGateway, aiResponse{Message: err.Error()})
		return
	}
	if len(completion.Choices) == 0 || strings.TrimSpace(completion.Choices[0].Message.Content) == "" {
		writeJSON(response, http.StatusBadGateway, aiResponse{Message: "The AI service returned an empty response."})
		return
	}
	writeJSON(response, http.StatusOK, aiResponse{Text: strings.TrimSpace(completion.Choices[0].Message.Content)})
}
