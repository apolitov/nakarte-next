<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  let {
    title,
    summary = '',
    open = $bindable(false),
    id,
    children,
  }: { title: string; summary?: string; open?: boolean; id: string; children: Snippet } = $props();
</script>

<div class="fold" class:open>
  <button class="fh" aria-expanded={open} aria-controls={id} onclick={() => (open = !open)}>
    <span class="fl">{title}</span>
    <span class="fs">{summary}</span>
    <span class="chev"><Icon name="chevron" size={16} stroke={2.4} /></span>
  </button>
  {#if open}
    <div class="fb" {id}>{@render children()}</div>
  {/if}
</div>

<style>
  .fold {
    border-radius: 12px;
    background: var(--tint);
    flex: none;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .fh {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 38px;
    padding: 6px 12px;
    text-align: left;
    border-radius: 12px;
  }
  .fh:hover {
    background: var(--tint2);
  }
  .fl {
    font-weight: 600;
    font-size: 13.5px;
    white-space: nowrap;
  }
  .fs {
    flex: 1;
    min-width: 0;
    color: var(--soft);
    font-size: 12.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chev {
    display: grid;
    color: var(--soft);
    transition: transform 0.15s;
  }
  .open .chev {
    transform: rotate(180deg);
  }
  .fb {
    padding: 2px 12px 12px;
    min-height: 0;
    overflow: auto;
  }
</style>
