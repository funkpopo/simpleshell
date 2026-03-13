import { useCallback, useEffect, useState } from "react";

export const useTerminalSearch = ({ searchAddonRef, termRef, isActive }) => {
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState({ count: 0, current: 0 });
  const [noMatchFound, setNoMatchFound] = useState(false);

  const handleSearch = useCallback(() => {
    if (searchAddonRef.current && searchTerm) {
      setNoMatchFound(false);

      try {
        const result = searchAddonRef.current.findNext(searchTerm);
        if (!result) {
          setNoMatchFound(true);
        } else if (searchResults.count > 0) {
          setSearchResults((prev) => ({
            ...prev,
            current: (prev.current % prev.count) + 1,
          }));
        }
      } catch {
        setNoMatchFound(true);
      }
    }
  }, [searchAddonRef, searchResults.count, searchTerm]);

  const handleSearchPrevious = useCallback(() => {
    if (searchAddonRef.current && searchTerm) {
      setNoMatchFound(false);

      try {
        const result = searchAddonRef.current.findPrevious(searchTerm);
        if (!result) {
          setNoMatchFound(true);
        } else if (searchResults.count > 0) {
          setSearchResults((prev) => ({
            ...prev,
            current: prev.current <= 1 ? prev.count : prev.current - 1,
          }));
        }
      } catch {
        setNoMatchFound(true);
      }
    }
  }, [searchAddonRef, searchResults.count, searchTerm]);

  const calculateSearchResults = useCallback(
    (term) => {
      if (!term || !termRef.current) {
        setSearchResults({ count: 0, current: 0 });
        return;
      }

      const buffer = termRef.current.buffer.active;
      let count = 0;

      try {
        for (let i = 0; i < buffer.length; i++) {
          const line = buffer.getLine(i);
          if (line) {
            const text = line.translateToString();
            let pos = 0;
            while ((pos = text.indexOf(term, pos)) !== -1) {
              count++;
              pos += term.length;
            }
          }
        }

        setSearchResults({ count, current: count > 0 ? 1 : 0 });
        setNoMatchFound(count === 0);
      } catch {
        setSearchResults({ count: 0, current: 0 });
      }
    },
    [termRef],
  );

  const openSearchBar = useCallback(() => {
    setShowSearchBar(true);
  }, []);

  const closeSearchBar = useCallback(() => {
    setShowSearchBar(false);
  }, []);

  const toggleSearchBar = useCallback(() => {
    setShowSearchBar((prev) => !prev);
  }, []);

  useEffect(() => {
    if (searchTerm && termRef.current) {
      calculateSearchResults(searchTerm);
    } else {
      setSearchResults({ count: 0, current: 0 });
      setNoMatchFound(false);
    }
  }, [calculateSearchResults, searchTerm, termRef]);

  useEffect(() => {
    if (!isActive && showSearchBar) {
      setShowSearchBar(false);
    }
  }, [isActive, showSearchBar]);

  return {
    showSearchBar,
    searchTerm,
    searchResults,
    noMatchFound,
    setSearchTerm,
    handleSearch,
    handleSearchPrevious,
    openSearchBar,
    closeSearchBar,
    toggleSearchBar,
  };
};
