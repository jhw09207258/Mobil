"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconDocuments, IconCode, IconSheet, IconMindmap, IconFiles, IconSearch, IconChevronDown, IconChevronRight } from "./icons";
import { Tooltip } from "@/components/ui/tooltip";
import { useWorkspace, type TabKind } from "./workspace/workspace-context";
import {
  searchOntology,
  searchSemantic,
  getLinkedObjects,
  type SearchResult,
  type LinkedObject,
  type SemanticResult,
} from "./search/actions";

const KIND_ICON: Record<string, (props: { size?: number }) => React.ReactElement> = {
  document: IconDocuments,
  code: IconCode,
  sheet: IconSheet,
  mindmap: IconMindmap,
  file: IconFiles,
};
const KIND_LABEL: Record<string, string> = {
  document: "Docs +",
  code: "Code",
  sheet: "Table",
  mindmap: "Link Graph",
  file: "Repository",
};
const TAB_KINDS = new Set(["document", "code", "sheet", "mindmap"]);

function ResultRow({
  result,
  onOpenItem,
}: {
  result: SearchResult;
  onOpenItem: (kind: string, id: string, title: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [links, setLinks] = useState<LinkedObject[] | null>(null);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const Icon = KIND_ICON[result.kind] ?? IconDocuments;
  const openable = TAB_KINDS.has(result.kind);

  const toggleExpand = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (links === null) {
      setLoadingLinks(true);
      const data = await getLinkedObjects(result.kind, result.id);
      setLinks(data);
      setLoadingLinks(false);
    }
  };

  return (
    <div className="search-result">
      <div
        className="search-result-main"
        role={openable ? "button" : undefined}
        tabIndex={openable ? 0 : undefined}
        onClick={openable ? () => onOpenItem(result.kind, result.id, result.title) : undefined}
        onKeyDown={
          openable
            ? (e) => {
                if (e.key === "Enter") onOpenItem(result.kind, result.id, result.title);
              }
            : undefined
        }
      >
        <span className="search-result-icon">
          <Icon size={14} />
        </span>
        <span className="search-result-body">
          <span className="search-result-title">{result.title || "Untitled"}</span>
          {result.snippet && <span className="search-result-snippet">{result.snippet}</span>}
        </span>
        <span className="search-result-kind">{KIND_LABEL[result.kind] ?? result.kind}</span>
        <button
          type="button"
          className="search-result-expand"
          onClick={toggleExpand}
          title="Show connected items"
          aria-label="Show connected items"
        >
          {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        </button>
      </div>
      {expanded && (
        <div className="search-linked">
          {loadingLinks && <span className="muted">Loading…</span>}
          {!loadingLinks && links && links.length === 0 && (
            <span className="muted">No connected items.</span>
          )}
          {!loadingLinks &&
            links &&
            links.map((l) => {
              const LIcon = KIND_ICON[l.kind] ?? IconDocuments;
              return (
                <button
                  key={`${l.kind}:${l.id}`}
                  type="button"
                  className="search-linked-item"
                  onClick={() => onOpenItem(l.kind, l.id, l.title)}
                >
                  <LIcon size={12} />
                  <span>{l.title || "Untitled"}</span>
                  {l.depth > 1 && l.via_title && (
                    <span className="dim" style={{ fontSize: 11 }}>
                      · via {l.via_title}
                    </span>
                  )}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

export function HeaderSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [semantic, setSemantic] = useState<SemanticResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  // 모바일에서는 검색창을 돋보기 아이콘으로 접어두고, 아이콘을 누를 때만
  // 검색 입력을 오버레이로 펼친다(헤더 가로 공간 절약).
  const [mobileOpen, setMobileOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { openTab } = useWorkspace();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setMobileOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // 모바일 검색을 펼치면 입력에 포커스를 준다.
  useEffect(() => {
    if (mobileOpen) inputRef.current?.focus();
  }, [mobileOpen]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSemantic([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      // 어휘 검색(즉답)과 의미 검색(임베딩 API 왕복)을 병렬로 — 어휘 결과를
      // 먼저 보여주고 의미 결과는 도착하는 대로 아래에 붙는다.
      const semanticPromise = searchSemantic(q).then(setSemantic);
      const data = await searchOntology(q);
      setResults(data);
      setLoading(false);
      await semanticPromise;
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const onOpenItem = (kind: string, id: string, title: string) => {
    if (TAB_KINDS.has(kind)) {
      openTab(kind as TabKind, id, title);
      setOpen(false);
      setMobileOpen(false);
      setQuery("");
    }
  };

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.kind] ??= []).push(r);
    return acc;
  }, {});

  // 어휘 결과에 이미 있는 항목은 의미 검색 섹션에서 제외(중복 표시 방지).
  const lexicalIds = new Set(results.map((r) => `${r.kind}:${r.id}`));
  const semanticOnly = semantic.filter((s) => !lexicalIds.has(`${s.kind}:${s.id}`));

  return (
    <div className={`hsearch ${mobileOpen ? "mobile-open" : ""}`} ref={rootRef}>
      <Tooltip content="Search">
        <button
          type="button"
          className="hsearch-icon-btn"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Search"
          aria-expanded={mobileOpen}
        >
          <IconSearch size={18} />
        </button>
      </Tooltip>
      <input
        ref={inputRef}
        className="hsearch-input"
        type="text"
        placeholder="Search Possion… (try #tag)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim() && (
        <div className="hsearch-dropdown">
          {loading && <div className="hsearch-empty">Searching…</div>}
          {!loading && results.length === 0 && semanticOnly.length === 0 && (
            <div className="hsearch-empty">No results for “{query}”.</div>
          )}
          {!loading &&
            Object.entries(grouped).map(([kind, rows]) => (
              <div key={kind} className="hsearch-group">
                <div className="hsearch-group-label">{KIND_LABEL[kind] ?? kind}</div>
                {rows.map((r) => (
                  <ResultRow key={`${r.kind}:${r.id}`} result={r} onOpenItem={onOpenItem} />
                ))}
              </div>
            ))}
          {!loading && semanticOnly.length > 0 && (
            <div className="hsearch-group">
              <div className="hsearch-group-label">Semantic matches</div>
              {semanticOnly.map((s) => (
                <ResultRow
                  key={`sem:${s.kind}:${s.id}`}
                  result={{
                    kind: s.kind,
                    id: s.id,
                    title: s.title,
                    snippet: `${Math.round(s.similarity * 100)}% related`,
                    rank: s.similarity,
                    updated_at: "",
                  }}
                  onOpenItem={onOpenItem}
                />
              ))}
            </div>
          )}
          {!loading && results.some((r) => r.kind === "file") && (
            <div className="hsearch-footer">
              <Link href="/files" onClick={() => setOpen(false)}>
                Open Repository to view matched files →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
