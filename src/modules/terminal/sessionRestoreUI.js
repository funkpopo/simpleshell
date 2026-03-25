const createSuggestionSuppressionContext = () => ({
  input: "",
  timestamp: 0,
});

const resetSessionRestoreInteractionState = ({
  setShowSuggestions,
  setSuggestions,
  setCurrentInput,
  setSuggestionsHiddenByEsc,
  setSuggestionsSuppressedUntilEnter,
  suggestionSelectedRef,
  suppressionContextRef,
} = {}) => {
  if (typeof setShowSuggestions === "function") {
    setShowSuggestions(false);
  }

  if (typeof setSuggestions === "function") {
    setSuggestions([]);
  }

  if (typeof setCurrentInput === "function") {
    setCurrentInput("");
  }

  if (typeof setSuggestionsHiddenByEsc === "function") {
    setSuggestionsHiddenByEsc(false);
  }

  if (typeof setSuggestionsSuppressedUntilEnter === "function") {
    setSuggestionsSuppressedUntilEnter(false);
  }

  if (suggestionSelectedRef) {
    suggestionSelectedRef.current = false;
  }

  if (suppressionContextRef) {
    suppressionContextRef.current = createSuggestionSuppressionContext();
  }
};

module.exports = {
  createSuggestionSuppressionContext,
  resetSessionRestoreInteractionState,
};
