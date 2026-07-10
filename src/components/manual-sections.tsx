"use client";

import { ChevronRightIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import type { ManualSection } from "@/lib/manual";

/**
 * 運営マニュアルを章単位で折りたたみ表示する。
 * 8章分を一度に開くと縦スクロールが長大化し認知負荷が高いため、
 * デフォルト全閉じ+目次から必要な章だけ開く構成にしている。
 */
export function ManualSections({ sections }: { sections: ManualSection[] }) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const detailsRefs = useRef<Record<string, HTMLDetailsElement | null>>({});

  function openFromToc(id: string) {
    setOpenIds((prev) => new Set(prev).add(id));
    requestAnimationFrame(() => {
      detailsRefs.current[id]?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  return (
    <>
      <nav aria-label="目次" className="mb-8 rounded-lg border p-4">
        <p className="text-sm font-semibold">目次</p>
        <ol className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="underline underline-offset-3 hover:text-muted-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  openFromToc(section.id);
                }}
              >
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-2">
        {sections.map((section) => (
          <details
            key={section.id}
            id={section.id}
            ref={(el) => {
              detailsRefs.current[section.id] = el;
            }}
            open={openIds.has(section.id)}
            onToggle={(e) => {
              const isOpen = e.currentTarget.open;
              setOpenIds((prev) => {
                const next = new Set(prev);
                if (isOpen) {
                  next.add(section.id);
                } else {
                  next.delete(section.id);
                }
                return next;
              });
            }}
            className="group scroll-mt-4 rounded-lg border px-4 py-3"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-base font-semibold [&::-webkit-details-marker]:hidden">
              {section.title}
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
            </summary>
            <div className="pb-1">
              <Markdown>{section.body}</Markdown>
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
