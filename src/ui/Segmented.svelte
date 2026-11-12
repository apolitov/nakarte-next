<script lang="ts" generics="T extends string | number">
  let {
    items,
    value,
    label,
    name,
    disabled = false,
    onchange,
  }: {
    items: readonly (readonly [T, string])[];
    value: T;
    label: string;
    name: string;
    disabled?: boolean;
    onchange: (v: T) => void;
  } = $props();
</script>

<div class="seg" role="radiogroup" aria-label={label} style="grid-template-columns:repeat({items.length},1fr)">
  {#each items as [v, t] (v)}
    <label>
      <input type="radio" {name} checked={value === v} {disabled} onchange={() => onchange(v)} />
      <span>{t}</span>
    </label>
  {/each}
</div>

<style>
  .seg {
    display: grid;
    gap: 2px;
    background: var(--seg-bg, var(--tint));
    border-radius: 11px;
    padding: 3px;
    flex: none;
  }
  label {
    position: relative;
  }
  input {
    position: absolute;
    inset: 0;
    opacity: 0;
    margin: 0;
    cursor: pointer;
  }
  input:disabled {
    cursor: default;
  }
  span {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 32px;
    padding: 4px 2px;
    border-radius: 8px;
    font-size: 13px;
    white-space: nowrap;
  }
  input:checked + span {
    background: var(--marker);
    color: var(--marker-ink);
    font-weight: 600;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
  }
  input:disabled + span {
    opacity: 0.45;
  }
  input:focus-visible + span {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }
  label:hover input:not(:checked):not(:disabled) + span {
    background: var(--seg-hover, var(--tint2));
  }
</style>
