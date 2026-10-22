import { useCallback, useEffect, useRef, useState } from "react";

const EMPTY_SEARCH_RESULTS = {
  count: 0,
  current: 0,
};

const DEFAULT_SEARCH_OPTIONS = Object.freeze({
  caseSensitive: false,
  regex: false,
  wholeWord: false,
});

export const useTerminalSearch = ({
  searchAddonRef,
  termRef,
  searchAddonVersion = 0,
}) => {
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState(EMPTY_SEARCH_RESULTS);
  const [noMatchFound, setNoMatchFound] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(
    DEFAULT_SEARCH_OPTIONS.caseSensitive,
  );
  const [useRegex, setUseRegex] = useState(DEFAULT_SEARCH_OPTIONS.regex);
  const [wholeWord, setWholeWord] = useState(DEFAULT_SEARCH_OPTIONS.wholeWord);

  const searchTermRef = useRef(searchTerm);
  const showSearchBarRef = useRef(showSearchBar);
  const searchOptionsRef = useRef({
    caseSensitive,
    regex: useRegex,
    wholeWord,
  });

  useEffect(() => {
    searchTermRef.current = searchTerm;
  }, [searchTerm]);

  useEffect(() => {
    showSearchBarRef.current = showSearchBar;
  }, [showSearchBar]);

  useEffect(() => {
    searchOptionsRef.current = {
      caseSensitive,
      regex: useRegex,
      wholeWord,
    };
  }, [caseSensitive, useRegex, wholeWord]);

  const getSearchOptions = useCallback(() => {
    const theme = termRef.current?.options?.theme;
    return {
      ...searchOptionsRef.current,
      decorations: {
        matchOverviewRuler:
          theme?.scrollbarSliderBackground || "rgba(112, 112, 112, 0.38)",
        activeMatchColorOverviewRuler:
          theme?.scrollbarSliderActiveBackground || "rgba(112, 112, 112, 0.72)",
      },
    };
  }, [termRef]);

  const clearSearchState = useCallback(
    ({ clearSelection = false } = {}) => {
      if (clearSelection) {
        try {
          searchAddonRef.current?.clearDecorations?.();
        } catch {
          // ignore search cleanup errors
        }

        try {
          termRef.current?.clearSelection?.();
        } catch {
          // ignore terminal selection cleanup errors
        }
      }

      setSearchResults(EMPTY_SEARCH_RESULTS);
      setNoMatchFound(false);
    },
    [searchAddonRef, termRef],
  );

  const runSearch = useCallback(
    async (direction = "next", options = {}) => {
      const searchAddon = searchAddonRef.current;
      const term = searchTermRef.current;

      if (!term) {
        clearSearchState({ clearSelection: true });
        return false;
      }

      if (!searchAddon) {
        return false;
      }

      try {
        const searchOptions = {
          ...getSearchOptions(),
          incremental: direction === "next" && options.incremental === true,
        };
        const found = await (direction === "previous"
          ? searchAddon.findPrevious(term, searchOptions)
          : searchAddon.findNext(term, searchOptions));
        return found;
      } catch {
        setSearchResults(EMPTY_SEARCH_RESULTS);
        setNoMatchFound(true);
        return false;
      }
    },
    [clearSearchState, getSearchOptions, searchAddonRef],
  );

  const handleSearch = useCallback(() => runSearch("next"), [runSearch]);

  const handleSearchPrevious = useCallback(
    () => runSearch("previous"),
    [runSearch],
  );

  const openSearchBar = useCallback(() => {
    setShowSearchBar(true);
  }, []);

  const closeSearchBar = useCallback(() => {
    setShowSearchBar(false);
    setSearchTerm("");
    clearSearchState({ clearSelection: true });
  }, [clearSearchState]);

  const toggleSearchBar = useCallback(() => {
    if (showSearchBarRef.current) {
      closeSearchBar();
      return;
    }
    openSearchBar();
  }, [closeSearchBar, openSearchBar]);

  const toggleCaseSensitive = useCallback(() => {
    setCaseSensitive((prev) => !prev);
  }, []);

  const toggleRegex = useCallback(() => {
    setUseRegex((prev) => !prev);
  }, []);

  const toggleWholeWord = useCallback(() => {
    setWholeWord((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!searchTerm) {
      clearSearchState({ clearSelection: true });
      return;
    }

    searchAddonRef.current?.clearDecorations?.();
    setSearchResults(EMPTY_SEARCH_RESULTS);
    setNoMatchFound(false);
    // Let a typing burst settle before starting a scan of a large history.
    const timer = setTimeout(() => {
      runSearch("next", { incremental: true });
    }, 120);
    return () => clearTimeout(timer);
  }, [
    caseSensitive,
    clearSearchState,
    runSearch,
    searchAddonVersion,
    searchAddonRef,
    searchTerm,
    useRegex,
    wholeWord,
  ]);

  useEffect(() => {
    const searchAddon = searchAddonRef.current;
    if (!searchAddon?.onDidChangeResults) {
      return undefined;
    }

    const disposable = searchAddon.onDidChangeResults(
      ({ resultCount, resultIndex }) => {
        setSearchResults({ count: resultCount, current: resultIndex + 1 });
        setNoMatchFound(Boolean(searchTermRef.current) && resultCount === 0);
      },
    );

    return () => {
      if (typeof disposable?.dispose === "function") {
        disposable.dispose();
      }
    };
  }, [searchAddonRef, searchAddonVersion]);

  return {
    showSearchBar,
    searchTerm,
    searchResults,
    noMatchFound,
    caseSensitive,
    useRegex,
    wholeWord,
    setSearchTerm,
    handleSearch,
    handleSearchPrevious,
    openSearchBar,
    closeSearchBar,
    toggleSearchBar,
    toggleCaseSensitive,
    toggleRegex,
    toggleWholeWord,
  };
};
