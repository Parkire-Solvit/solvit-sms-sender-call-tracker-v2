import React, { useState, useEffect, useRef } from 'react';
import { Search, Phone, History, User, X, Clock } from 'lucide-react';

interface SearchContactBarProps {
  onSelectPhone: (phone: string) => void;
}

interface SearchResult {
  target_phone: string;
  total_interactions: number;
  last_interaction: string;
  last_agent_name: string;
}

export const SearchContactBar: React.FC<SearchContactBarProps> = ({ onSelectPhone }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim().length >= 3) {
        searchContacts(query.trim());
      } else {
        setResults([]);
        setIsOpen(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  const searchContacts = async (q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/search-contacts?query=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data);
        setIsOpen(true);
      }
    } catch (err) {
      console.error('Failed to search contacts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (phone: string) => {
    onSelectPhone(phone);
    setIsOpen(false);
    setQuery('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSelectPhone(query.trim());
      setIsOpen(false);
    }
  };

  return (
    <div ref={dropdownRef} className="relative w-full max-w-md">
      <form onSubmit={handleSubmit} className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          id="global-contact-search-input"
          type="text"
          placeholder="Look up any customer phone history..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
          className="w-full pl-10 pr-9 py-2 text-xs font-semibold text-slate-900 bg-white border border-slate-200 rounded-xl shadow-xs focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setResults([]);
              setIsOpen(false);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </form>

      {/* Dropdown Suggestions */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-40 max-h-80 overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
          <div className="p-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between text-[11px] text-slate-500 font-semibold px-3">
            <span>Matching Contact Threads ({results.length})</span>
            {loading && <Clock className="w-3 h-3 animate-spin text-amber-600" />}
          </div>

          {results.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400">
              No matching phone numbers found in history.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {results.map((item) => (
                <button
                  key={item.target_phone}
                  type="button"
                  onClick={() => handleSelect(item.target_phone)}
                  className="w-full p-3 text-left hover:bg-amber-50/50 flex items-center justify-between transition-colors group"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-amber-100 text-amber-800">
                      <Phone className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="font-mono font-bold text-xs text-slate-900 group-hover:text-amber-700 block">
                        {item.target_phone}
                      </span>
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <User className="w-3 h-3 text-slate-300" />
                        Last handled by {item.last_agent_name}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[11px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                      {item.total_interactions} events
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5 font-mono">
                      {new Date(item.last_interaction).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
