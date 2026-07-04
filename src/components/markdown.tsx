import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * 運営マニュアル(docs/manual.md)表示用のMarkdownレンダラー。
 * @tailwindcss/typography を足す代わりに要素ごとにshadcnのトークンへ
 * マッピングする — 依存を増やさず、管理画面と見た目を揃えるため。
 * remark-gfm は原稿がテーブルとタスクリストを使うので必須。
 */

// react-markdown が渡す `node`(hast要素)はDOMに流せないので取り除く
function domProps<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
  const rest: T & { node?: unknown } = { ...props };
  delete rest.node;
  return rest;
}

const components: Components = {
  h1: (props) => (
    <h1 className="text-xl font-semibold" {...domProps(props)} />
  ),
  h2: (props) => (
    <h2
      className="mt-10 border-b pb-2 text-lg font-semibold"
      {...domProps(props)}
    />
  ),
  h3: (props) => (
    <h3 className="mt-8 text-base font-semibold" {...domProps(props)} />
  ),
  h4: (props) => (
    <h4 className="mt-6 text-sm font-semibold" {...domProps(props)} />
  ),
  p: (props) => (
    <p className="mt-4 text-sm leading-relaxed" {...domProps(props)} />
  ),
  ul: (props) => (
    <ul
      className="mt-4 list-disc space-y-1 pl-5 text-sm leading-relaxed"
      {...domProps(props)}
    />
  ),
  ol: (props) => (
    <ol
      className="mt-4 list-decimal space-y-1 pl-5 text-sm leading-relaxed"
      {...domProps(props)}
    />
  ),
  // スマホ幅では原稿のテーブルが収まらないため、表単位で横スクロールさせる
  table: (props) => (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm" {...domProps(props)} />
    </div>
  ),
  th: (props) => (
    <th
      className="border-b px-3 py-2 text-left font-medium whitespace-nowrap"
      {...domProps(props)}
    />
  ),
  td: (props) => (
    <td
      // min-w: スマホ幅で見出し列が1文字ずつ縦に折れるのを防ぐ(はみ出す分は横スクロール)
      className="min-w-24 border-b px-3 py-2 align-top leading-relaxed"
      {...domProps(props)}
    />
  ),
  blockquote: (props) => (
    <blockquote
      className="mt-4 rounded-md border bg-muted/50 px-4 py-3 [&>p]:mt-0 [&>p+p]:mt-2"
      {...domProps(props)}
    />
  ),
  pre: (props) => (
    <pre
      className="mt-4 overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed [&_code]:bg-transparent [&_code]:p-0"
      {...domProps(props)}
    />
  ),
  code: (props) => {
    const { className, ...rest } = domProps(props);
    return (
      <code
        className={cn(
          "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]",
          className,
        )}
        {...rest}
      />
    );
  },
  a: (props) => (
    <a
      className="underline underline-offset-3 hover:text-muted-foreground"
      target="_blank"
      rel="noreferrer"
      {...domProps(props)}
    />
  ),
  hr: (props) => <hr className="my-8" {...domProps(props)} />,
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
