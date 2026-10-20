<script lang="ts">
  import { StickyNote } from "$lib/icons";
  import { autosize } from "$lib/ui/autosize";

  // GM 메모 칸. 쓰는 대로 저장되고, Enter(또는 Esc)를 누르면 닫고 편집기로 돌아간다. 줄을 바꾸려면 Shift+Enter.
  let {
    value,
    onchange,
    ondone,
    autofocus = false,
  }: { value: string; onchange: (value: string) => void; ondone: (refocus: boolean) => void; autofocus?: boolean } = $props();

  /** Enter·Esc로 닫는 중 (뒤따르는 blur에서 또 닫지 않게) */
  let closing = false;

  let textarea = $state<HTMLTextAreaElement>();

  $effect(() => {
    if (autofocus) textarea?.focus();
  });
</script>

<div class="note">
  <StickyNote size={13} />
  <textarea
    bind:this={textarea}
    use:autosize={value}
    rows="1"
    spellcheck="false"
    placeholder="GM 메모 (복사되지 않음) — Enter 저장 · Shift+Enter 줄바꿈"
    {value}
    oninput={(e) => onchange(e.currentTarget.value)}
    onblur={() => {
      if (!closing) ondone(false);
      closing = false;
    }}
    onkeydown={(e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        onchange(e.currentTarget.value.trim());
        closing = true;
        ondone(true);
      }
    }}
  ></textarea>
</div>

<style>
  .note {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    margin-top: 4px;
    padding: 4px 4px 4px 8px;
    border-left: 3px solid var(--note);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: var(--note-soft);
    color: var(--note);
  }

  .note :global(svg) {
    flex: none;
    margin-top: 5px;
  }

  textarea {
    flex: 1;
    min-width: 0;
    padding: 2px 4px;
    border: 0;
    background: transparent;
    color: var(--text);
    font-size: 13px;
    line-height: 1.55;
    resize: none;
    overflow: hidden;
  }

  textarea:focus {
    outline: none;
  }

  textarea::placeholder {
    color: var(--note);
    opacity: 0.7;
  }
</style>
