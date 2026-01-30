<script setup lang="ts">
import { ConnectError, Code } from '@connectrpc/connect';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  createListItemsRequest,
  type Item,
  type ListItemsResponse,
} from './lib/sickrock';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import {
  EditItemRequestSchema,
  type EditItemRequest,
  CreateItemRequestSchema,
  type CreateItemRequest,
  DeleteItemRequestSchema,
  type DeleteItemRequest,
} from './gen/sickrock_pb';
import { createSickRockClient } from './lib/sickrockClient';

const STORAGE_KEYS = {
  baseUrl: 'otto-base-url',
  token: 'otto-token',
} as const;

const LEGACY_KEYS = {
  baseUrl: 'sickrock.baseUrl',
  token: 'sickrock.token',
} as const;

const baseUrl = ref('');
const username = ref('');
const password = ref('');
const token = ref<string | null>(null);
const statusItems = ref<Item[]>([]);
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);
const showConnectionUI = ref(true);
const editingItem = ref<Item | null>(null);
const itemNameInput = ref('');
const itemNameInputRef = ref<HTMLInputElement | null>(null);
const feelingInput = ref('');
const feelingInputRef = ref<HTMLInputElement | null>(null);
const tagsInput = ref('');
const showCreateDialog = ref(false);
const newItemName = ref('');
const newItemFeeling = ref('');
const newItemTags = ref('');
const newItemNameInputRef = ref<HTMLInputElement | null>(null);
const filterQuery = ref('');
const itemToDelete = ref<Item | null>(null);
const showDeleteConfirmation = ref(false);
const REFRESH_INTERVAL_SECONDS = 30;
const refreshCountdown = ref(REFRESH_INTERVAL_SECONDS);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

if (typeof window !== 'undefined') {
  const storedBaseUrl =
    window.localStorage.getItem(STORAGE_KEYS.baseUrl) ??
    window.localStorage.getItem(LEGACY_KEYS.baseUrl);

  if (storedBaseUrl !== null) {
    baseUrl.value = storedBaseUrl;
    window.localStorage.setItem(STORAGE_KEYS.baseUrl, storedBaseUrl);
    window.localStorage.removeItem(LEGACY_KEYS.baseUrl);
  }

  const storedToken =
    window.localStorage.getItem(STORAGE_KEYS.token) ??
    window.localStorage.getItem(LEGACY_KEYS.token);

  if (storedToken !== null) {
    token.value = storedToken;
    window.localStorage.setItem(STORAGE_KEYS.token, storedToken);
    window.localStorage.removeItem(LEGACY_KEYS.token);
  }
}

watch(baseUrl, (value) => {
  if (typeof window !== 'undefined') {
    if (value.length) {
      window.localStorage.setItem(STORAGE_KEYS.baseUrl, value);
    } else {
      window.localStorage.removeItem(STORAGE_KEYS.baseUrl);
    }
    window.localStorage.removeItem(LEGACY_KEYS.baseUrl);
  }

  if (!value.trim()) {
    token.value = null;
  }
});

watch(token, (value) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (value) {
    window.localStorage.setItem(STORAGE_KEYS.token, value);
  } else {
    window.localStorage.removeItem(STORAGE_KEYS.token);
  }
  window.localStorage.removeItem(LEGACY_KEYS.token);
});

const effectiveBaseUrl = computed(() => baseUrl.value.trim());
const needsAuth = computed(() => effectiveBaseUrl.value.length > 0);
const hasToken = computed(() => Boolean(token.value));

const baseUrlMissingApiSuffix = computed(() => {
  const url = effectiveBaseUrl.value;
  if (!url) return false;
  const normalized = url.replace(/\/+$/, '');
  return !normalized.endsWith('/api');
});

const clearStoredToken = () => {
  token.value = null;
  showConnectionUI.value = true;
};

type KarmaCategory = 'good' | 'warn' | 'bad';
type KarmaTier = 'positive' | 'warning' | 'negative' | 'neutral';

const parseKarmaValue = (item: Item): KarmaCategory | null => {
  const raw = item.additionalFields?.karma;
  if (raw === undefined || typeof raw !== 'string') {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'good' || normalized === 'warn' || normalized === 'bad') {
    return normalized;
  }

  return null;
};

const getKarmaTier = (item: Item): KarmaTier => {
  const category = parseKarmaValue(item);

  switch (category) {
    case 'good':
      return 'positive';
    case 'warn':
      return 'warning';
    case 'bad':
      return 'negative';
    default:
      return 'neutral';
  }
};

const getKarmaClass = (item: Item) => {
  const tier = getKarmaTier(item);
  return tier === 'neutral' ? null : `karma-${tier}`;
};

const getKarmaLabel = (item: Item): string | null => {
  const category = parseKarmaValue(item);
  if (!category) {
    return null;
  }

  return category.charAt(0).toUpperCase() + category.slice(1);
};

type ParsedTag = { key: string; value: string };

const parseTagsString = (raw: string | undefined): ParsedTag[] => {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return [];
  }
  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const result: ParsedTag[] = [];
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex >= 0) {
      result.push({
        key: line.slice(0, colonIndex).trim(),
        value: line.slice(colonIndex + 1).trim(),
      });
    } else if (line) {
      result.push({ key: line, value: '' });
    }
  }
  return result;
};

const getParsedTags = (item: Item): ParsedTag[] =>
  parseTagsString(item.additionalFields?.tags);

const parseFilterExpression = (raw: string): { negations: string[]; positives: string[] } => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { negations: [], positives: [] };
  }
  const terms = trimmed.split(/\s+/).filter(Boolean);
  const negations: string[] = [];
  const positives: string[] = [];
  for (const t of terms) {
    if (t.startsWith('!')) {
      const rest = t.slice(1).trim();
      if (rest) negations.push(rest);
    } else {
      positives.push(t);
    }
  }
  return { negations, positives };
};

const itemTagContainsTerm = (item: Item, term: string): boolean => {
  const lower = term.toLowerCase();
  const tags = getParsedTags(item);
  for (const tag of tags) {
    if (tag.key.toLowerCase().includes(lower) || tag.value.toLowerCase().includes(lower)) {
      return true;
    }
  }
  return false;
};

const filteredBySearch = computed(() => {
  const { negations, positives } = parseFilterExpression(filterQuery.value);
  let list = pendingStatusItems.value;
  for (const term of negations) {
    list = list.filter((item) => !itemTagContainsTerm(item, term));
  }
  if (positives.length > 0) {
    list = list.filter((item) => positives.some((term) => itemTagContainsTerm(item, term)));
  }
  return list;
});

const hashString = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
};

const getTagStyle = (key: string): { background: string; color: string; border: string; '--tag-separator-color': string } => {
  const hue = hashString(key) % 360;
  const sat = 72;
  const lightBg = 92;
  const lightFg = 28;
  const lightSeparator = Math.min(100, lightFg + (100 - lightFg) * 0.5);
  const color = `hsl(${hue}, ${sat}%, ${lightFg}%)`;
  return {
    background: `hsl(${hue}, ${sat}%, ${lightBg}%)`,
    color,
    border: `1px solid ${color}`,
    '--tag-separator-color': `hsl(${hue}, ${sat}%, ${lightSeparator}%)`,
  };
};

const NAME_FIELD_CANDIDATES = ['name', 'Name', 'title', 'Title'] as const;

const getItemName = (item: Item): string => {
  const fields = item.additionalFields ?? {};

  for (const key of NAME_FIELD_CANDIDATES) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return 'Untitled task';
};

const getItemSuggestion = (item: Item): string | null => {
  const fields = item.additionalFields ?? {};
  const suggestion = fields.suggestion || fields.Suggestion;
  if (typeof suggestion === 'string' && suggestion.trim().length > 0) {
    return suggestion.trim();
  }
  return null;
};

const isItemRecentlyUpdated = (item: Item): boolean => {
  const fields = item.additionalFields ?? {};
  const lastUpdate = fields.last_human_update;
  
  if (!lastUpdate || typeof lastUpdate !== 'string') {
    return false;
  }

  try {
    // Parse the timestamp format: "YYYY-MM-DD HH:MM:SS"
    const [datePart, timePart] = lastUpdate.trim().split(' ');
    if (!datePart || !timePart) {
      return false;
    }
    
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes, seconds] = timePart.split(':').map(Number);
    
    const updateDate = new Date(year, month - 1, day, hours, minutes, seconds);
    const now = new Date();
    const diffMs = now.getTime() - updateDate.getTime();
    const diffMinutes = diffMs / (1000 * 60);
    
    return diffMinutes < 15;
  } catch {
    return false;
  }
};

const pendingStatusItems = computed(() => {
  return statusItems.value.filter((item) => !isItemRecentlyUpdated(item));
});

const filteredStatusItems = computed(() => {
  return filteredBySearch.value.slice(0, 3);
});

const hiddenStatusItemCount = computed(() => {
  return Math.max(filteredBySearch.value.length - filteredStatusItems.value.length, 0);
});

const attemptInitialInit = async (): Promise<boolean> => {
  if (!token.value) {
    return false;
  }

  try {
    const client = createSickRockClient(
      needsAuth.value ? effectiveBaseUrl.value : undefined,
      undefined,
      token.value,
    );
    const initResponse = await client.init({});
    showConnectionUI.value = false;

    const currentUsername =
      (initResponse as { currentUsername?: string | null }).currentUsername ?? null;

    if (typeof currentUsername === 'string' && currentUsername.trim().length > 0) {
      await refreshStatusItems();
      return true;
    }
    return false;
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.Unauthenticated) {
      clearStoredToken();
    } else {
      showConnectionUI.value = true;
    }
    return false;
  }
};

const refreshCountdownLabel = computed(() =>
  isLoading.value ? 'Refreshing…' : `Next refresh in ${refreshCountdown.value}s`,
);

const clearAutoRefresh = () => {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
};

const beginAutoRefresh = () => {
  if (typeof window === 'undefined') {
    return;
  }

  clearAutoRefresh();
  refreshCountdown.value = REFRESH_INTERVAL_SECONDS;

  refreshTimer = setInterval(() => {
    if (refreshCountdown.value <= 1) {
      if (isLoading.value) {
        return;
      }
      clearAutoRefresh();
      refreshCountdown.value = 0;
      void refreshStatusItems();
      return;
    }

    refreshCountdown.value -= 1;
  }, 1000);
};

async function refreshStatusItems() {
  clearAutoRefresh();
  isLoading.value = true;
  errorMessage.value = null;
  if (!statusItems.value.length && !hasToken.value) {
    showConnectionUI.value = true;
  }

  const sanitizedUsername = username.value.trim();
  const sanitizedPassword = password.value;

  const credentials = needsAuth.value
    ? {
        username: sanitizedUsername,
        password: sanitizedPassword,
      }
    : undefined;

  const requiresLogin = needsAuth.value && !token.value;

  if (
    requiresLogin &&
    (!credentials ||
      !credentials.username ||
      credentials.password.length === 0)
  ) {
    errorMessage.value = 'Username and password are required for direct connections.';
    statusItems.value = [];
    isLoading.value = false;
    beginAutoRefresh();
    return;
  }

  const runListItems = async (): Promise<ListItemsResponse> => {
    let client = createSickRockClient(
      needsAuth.value ? effectiveBaseUrl.value : undefined,
      credentials,
      token.value,
    );

    if (needsAuth.value && credentials && !token.value) {
      const loginResponse = await client.login({
        username: credentials.username,
        password: credentials.password,
      });

      if (!loginResponse.token) {
        throw new Error('Login response did not return a token.');
      }

      token.value = loginResponse.token;
      client = createSickRockClient(
        effectiveBaseUrl.value,
        credentials,
        token.value,
      );
    }

    return client.listItems(
      createListItemsRequest({
        tcName: 'status',
        where: {},
      }),
    );
  };

  const handleError = (error: unknown) => {
    if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = String(error);
    }
    statusItems.value = [];
  };

  try {
    const response = await runListItems();
    statusItems.value = response.items;
    showConnectionUI.value = false;
  } catch (error) {
    if (
      needsAuth.value &&
      error instanceof ConnectError &&
      error.code === Code.Unauthenticated
    ) {
      token.value = null;
      try {
        const response = await runListItems();
        statusItems.value = response.items;
        showConnectionUI.value = false;
        return;
      } catch (retryError) {
        handleError(retryError);
        showConnectionUI.value = true;
      }
    } else {
      handleError(error);
      showConnectionUI.value = true;
    }
  } finally {
    isLoading.value = false;
    beginAutoRefresh();
  }
}

const handleSubmit = async () => {
  await refreshStatusItems();
};

const createEditItemRequest = (
  init: MessageInitShape<typeof EditItemRequestSchema> = {},
) => create(EditItemRequestSchema, init);

const createCreateItemRequest = (
  init: MessageInitShape<typeof CreateItemRequestSchema> = {},
) => create(CreateItemRequestSchema, init);

const createDeleteItemRequest = (
  init: MessageInitShape<typeof DeleteItemRequestSchema> = {},
) => create(DeleteItemRequestSchema, init);

const handleItemClick = (item: Item) => {
  editingItem.value = item;
  itemNameInput.value = getItemName(item);
  feelingInput.value = item.additionalFields?.feeling || '';
  tagsInput.value = item.additionalFields?.tags || '';
};

const handleItemRightClick = (event: MouseEvent, item: Item) => {
  event.preventDefault();
  itemToDelete.value = item;
  showDeleteConfirmation.value = true;
};

const cancelDelete = () => {
  itemToDelete.value = null;
  showDeleteConfirmation.value = false;
};

const confirmDelete = async () => {
  if (!itemToDelete.value) return;

  const item = itemToDelete.value;
  isLoading.value = true;
  errorMessage.value = null;

  try {
    const sanitizedUsername = username.value.trim();
    const sanitizedPassword = password.value;

    const credentials = needsAuth.value
      ? {
          username: sanitizedUsername,
          password: sanitizedPassword,
        }
      : undefined;

    let client = createSickRockClient(
      needsAuth.value ? effectiveBaseUrl.value : undefined,
      credentials,
      token.value,
    );

    if (needsAuth.value && credentials && !token.value) {
      const loginResponse = await client.login({
        username: credentials.username,
        password: credentials.password,
      });

      if (!loginResponse.token) {
        throw new Error('Login response did not return a token.');
      }

      token.value = loginResponse.token;
      client = createSickRockClient(
        effectiveBaseUrl.value,
        credentials,
        token.value,
      );
    }

    const request = createDeleteItemRequest({
      id: item.id,
      pageId: 'status',
    });

    await client.deleteItem(request);
    
    // Remove the deleted item from the list
    const itemIndex = statusItems.value.findIndex((i) => i.id === item.id);
    if (itemIndex !== -1) {
      statusItems.value.splice(itemIndex, 1);
    }
    
    cancelDelete();
    await refreshStatusItems();
  } catch (error) {
    if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = String(error);
    }
  } finally {
    isLoading.value = false;
  }
};

const cancelEdit = () => {
  editingItem.value = null;
  itemNameInput.value = '';
  feelingInput.value = '';
  tagsInput.value = '';
};

const saveItem = async () => {
  if (!editingItem.value) return;

  const item = editingItem.value;
  isLoading.value = true;
  errorMessage.value = null;

  try {
    const sanitizedUsername = username.value.trim();
    const sanitizedPassword = password.value;

    const credentials = needsAuth.value
      ? {
          username: sanitizedUsername,
          password: sanitizedPassword,
        }
      : undefined;

    let client = createSickRockClient(
      needsAuth.value ? effectiveBaseUrl.value : undefined,
      credentials,
      token.value,
    );

    if (needsAuth.value && credentials && !token.value) {
      const loginResponse = await client.login({
        username: credentials.username,
        password: credentials.password,
      });

      if (!loginResponse.token) {
        throw new Error('Login response did not return a token.');
      }

      token.value = loginResponse.token;
      client = createSickRockClient(
        effectiveBaseUrl.value,
        credentials,
        token.value,
      );
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const formattedTimestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

    const additionalFields: { [key: string]: string } = {
      ...item.additionalFields,
      feeling: feelingInput.value,
      tags: tagsInput.value,
      last_human_update: formattedTimestamp,
    };

    // Update the name field
    const nameValue = itemNameInput.value.trim();
    if (nameValue) {
      additionalFields.name = nameValue;
    }

    const request = createEditItemRequest({
      id: item.id,
      pageId: 'status',
      additionalFields,
    });

    await client.editItem(request);
    
    // Remove the updated item from the list
    const itemIndex = statusItems.value.findIndex((i) => i.id === item.id);
    if (itemIndex !== -1) {
      statusItems.value.splice(itemIndex, 1);
    }
    
    editingItem.value = null;
    itemNameInput.value = '';
    feelingInput.value = '';
    tagsInput.value = '';
  } catch (error) {
    if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = String(error);
    }
  } finally {
    isLoading.value = false;
  }
};

const handleEscapeKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    if (editingItem.value) {
      cancelEdit();
    } else if (showCreateDialog.value) {
      cancelCreate();
    } else if (showDeleteConfirmation.value) {
      cancelDelete();
    }
  }
};

const openCreateDialog = () => {
  showCreateDialog.value = true;
  newItemName.value = '';
  newItemFeeling.value = '';
  newItemTags.value = '';
};

const cancelCreate = () => {
  showCreateDialog.value = false;
  newItemName.value = '';
  newItemFeeling.value = '';
  newItemTags.value = '';
};

const createItem = async () => {
  if (!newItemName.value.trim()) {
    errorMessage.value = 'Item name is required.';
    return;
  }

  isLoading.value = true;
  errorMessage.value = null;

  try {
    const sanitizedUsername = username.value.trim();
    const sanitizedPassword = password.value;

    const credentials = needsAuth.value
      ? {
          username: sanitizedUsername,
          password: sanitizedPassword,
        }
      : undefined;

    let client = createSickRockClient(
      needsAuth.value ? effectiveBaseUrl.value : undefined,
      credentials,
      token.value,
    );

    if (needsAuth.value && credentials && !token.value) {
      const loginResponse = await client.login({
        username: credentials.username,
        password: credentials.password,
      });

      if (!loginResponse.token) {
        throw new Error('Login response did not return a token.');
      }

      token.value = loginResponse.token;
      client = createSickRockClient(
        effectiveBaseUrl.value,
        credentials,
        token.value,
      );
    }

    const additionalFields: { [key: string]: string } = {
      name: newItemName.value.trim(),
    };

    if (newItemFeeling.value.trim()) {
      additionalFields.feeling = newItemFeeling.value.trim();
    }

    if (newItemTags.value.trim()) {
      additionalFields.tags = newItemTags.value.trim();
    }

    const request = createCreateItemRequest({
      pageId: 'status',
      additionalFields,
    });

    await client.createItem(request);
    
    cancelCreate();
    await refreshStatusItems();
  } catch (error) {
    if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = String(error);
    }
  } finally {
    isLoading.value = false;
  }
};

watch(editingItem, async (isEditing) => {
  if (isEditing) {
    window.addEventListener('keydown', handleEscapeKey);
    await nextTick();
    itemNameInputRef.value?.focus();
  } else {
    window.removeEventListener('keydown', handleEscapeKey);
  }
});

watch(showCreateDialog, async (isShowing) => {
  if (isShowing) {
    window.addEventListener('keydown', handleEscapeKey);
    await nextTick();
    newItemNameInputRef.value?.focus();
  } else {
    window.removeEventListener('keydown', handleEscapeKey);
  }
});

watch(showDeleteConfirmation, (isShowing) => {
  if (isShowing) {
    window.addEventListener('keydown', handleEscapeKey);
  } else {
    window.removeEventListener('keydown', handleEscapeKey);
  }
});

onMounted(async () => {
  let refreshedViaInit = false;
  if (token.value) {
    refreshedViaInit = await attemptInitialInit();
  }
  if (!refreshedViaInit) {
    await refreshStatusItems();
  }
});

onUnmounted(() => {
  clearAutoRefresh();
  window.removeEventListener('keydown', handleEscapeKey);
});
</script>

<template>
  <main class="app">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="240"
      height="240"
      viewBox="0 0 240 240"
      role="img"
      aria-labelledby="title desc"
      class="logo"
      @click="openCreateDialog"
      style="cursor: pointer;"
    >
      <title id="title">Otto personal assistant logo</title>
      <desc id="desc">A bold circular badge with a friendly, centered robot face and a soft steel-blue palette.</desc>
      <defs>
        <linearGradient id="otto-gradient" x1="18%" y1="14%" x2="82%" y2="86%">
          <stop offset="0%" stop-color="#F4F6F8"/>
          <stop offset="48%" stop-color="#DEE3E7"/>
          <stop offset="100%" stop-color="#B3BDC6"/>
        </linearGradient>
        <filter id="bubble-shadow" x="-15%" y="-25%" width="130%" height="160%" color-interpolation-filters="sRGB">
          <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0F1C3F" flood-opacity="0.35" />
        </filter>
      </defs>

      <g class="otto-hover" filter="url(#bubble-shadow)">
        <circle cx="80" cy="80" r="77" fill="none" stroke="#9CA6AE" stroke-width="6"/>
        <circle cx="80" cy="80" r="74" fill="url(#otto-gradient)"/>
        <g transform="translate(42 46)">
          <g opacity="0.95">
            <circle cx="22" cy="24" r="16" fill="#FFFFFF"/>
            <circle cx="58" cy="24" r="16" fill="#FFFFFF"/>
          </g>
          <g opacity="0.92">
            <circle cx="22" cy="24" r="9" fill="#4C5D86"/>
            <circle cx="58" cy="24" r="9" fill="#4C5D86"/>
          </g>
          <g opacity="0.85">
            <circle
              cx="18"
              cy="20"
              r="3.5"
              fill="#FFFFFF"
              class="pupil pupil-left"
            />
            <circle
              cx="54"
              cy="20"
              r="3.5"
              fill="#FFFFFF"
              class="pupil pupil-right"
            />
          </g>
          <path d="M10 58c12 14 48 14 60 0" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" opacity="0.82"/>
        </g>
      </g>
    </svg>
    <section class="card results-card">
      <p v-if="isLoading" class="info">Loading…</p>
      <p v-else-if="errorMessage" class="error">Request failed: {{ errorMessage }}</p>
      <template v-else>
        <div v-if="statusItems.length > 0" class="filter-field">
          <input
            id="filter-input"
            v-model="filterQuery"
            class="base-url-input filter-input"
            type="text"
            placeholder="Filter (!negation includes positive, e.g. !due redhat)"
            :disabled="isLoading"
          />
        </div>
        <template v-if="filteredStatusItems.length">
          <ol class="items-list">
          <li
            v-for="(item, index) in filteredStatusItems"
            :key="item.id || index"
            :class="['items-list-entry', getKarmaClass(item)]"
            @click="handleItemClick(item)"
            @contextmenu="handleItemRightClick($event, item)"
          >
            <div class="item-body">
              <div class="item-content">
                <span class="item-name">{{ getItemName(item) }}</span>
                <span
                  v-if="getItemSuggestion(item) !== null"
                  class="item-suggestion"
                >
                  {{ getItemSuggestion(item) }}
                </span>
                <div v-if="getParsedTags(item).length" class="item-tags">
                  <span
                    v-for="(tag, tagIdx) in getParsedTags(item)"
                    :key="tagIdx"
                    class="item-tag"
                    :style="getTagStyle(tag.key)"
                  >
                    <span :class="['item-tag-key', { 'item-tag-key--has-value': tag.value }]">{{ tag.key }}</span><span v-if="tag.value" class="item-tag-value">{{ tag.value }}</span>
                  </span>
                </div>
              </div>
              <span
                v-if="getKarmaLabel(item) !== null"
                class="item-karma"
                :class="getKarmaClass(item)"
              >
                {{ getKarmaLabel(item) }}
              </span>
            </div>
          </li>
        </ol>
      </template>
      <p v-else-if="statusItems.length === 0" class="info">No items returned.</p>
      <p v-else class="info">All items have been recently updated.</p>
      </template>
    </section>
    <div>
        <p v-if="hiddenStatusItemCount > 0" class="info remaining-items">
          {{ hiddenStatusItemCount }} more thing{{ hiddenStatusItemCount === 1 ? '' : 's' }} to do after this
        </p>
    </div>
    <div
      v-if="editingItem"
      class="edit-modal-overlay"
      @click.self="cancelEdit"
    >
      <div class="edit-modal">
        <h3>Update Item</h3>
        <div class="field">
          <input
            id="item-name-input"
            ref="itemNameInputRef"
            v-model="itemNameInput"
            class="base-url-input"
            type="text"
            placeholder="Item name"
            :disabled="isLoading"
            @keyup.enter="saveItem"
            @keyup.esc="cancelEdit"
          />
        </div>
        <div class="field">
          <input
            id="feeling-input"
            ref="feelingInputRef"
            v-model="feelingInput"
            class="base-url-input"
            type="text"
            placeholder="Feeling"
            :disabled="isLoading"
            @keyup.enter="saveItem"
            @keyup.esc="cancelEdit"
          />
        </div>
        <div class="field">
          <textarea
            id="tags-input"
            v-model="tagsInput"
            class="base-url-input tags-textarea"
            placeholder="Tags (one per line, key:value)"
            rows="3"
            :disabled="isLoading"
            @keyup.esc="cancelEdit"
          />
        </div>
      </div>
    </div>
    <div
      v-if="showCreateDialog"
      class="edit-modal-overlay"
      @click.self="cancelCreate"
    >
      <div class="edit-modal">
        <h3>Create</h3>
        <div class="field">
          <input
            id="new-item-name-input"
            ref="newItemNameInputRef"
            v-model="newItemName"
            class="base-url-input"
            type="text"
            placeholder="Item name"
            :disabled="isLoading"
            @keyup.enter="createItem"
            @keyup.esc="cancelCreate"
          />
        </div>
        <div class="field">
          <input
            id="new-item-feeling-input"
            v-model="newItemFeeling"
            class="base-url-input"
            type="text"
            placeholder="Feeling (optional)"
            :disabled="isLoading"
            @keyup.enter="createItem"
            @keyup.esc="cancelCreate"
          />
        </div>
        <div class="field">
          <textarea
            id="new-item-tags-input"
            v-model="newItemTags"
            class="base-url-input tags-textarea"
            placeholder="Tags (one per line, key:value)"
            rows="3"
            :disabled="isLoading"
            @keyup.esc="cancelCreate"
          />
        </div>
      </div>
    </div>
    <div
      v-if="showDeleteConfirmation"
      class="edit-modal-overlay"
      @click.self="cancelDelete"
    >
      <div class="edit-modal">
        <h3>Delete Item</h3>
        <p v-if="itemToDelete" class="delete-confirmation-text">
          Are you sure you want to delete "{{ getItemName(itemToDelete) }}"?
        </p>
        <p class="delete-warning">This action cannot be undone.</p>
        <div class="actions">
          <button type="button" class="danger" :disabled="isLoading" @click="confirmDelete">
            {{ isLoading ? 'Deleting…' : 'Delete' }}
          </button>
          <button type="button" class="secondary" :disabled="isLoading" @click="cancelDelete">
            Cancel
          </button>
        </div>
      </div>
    </div>
    <section v-if="showConnectionUI" class="card connection-card">
      <h2>Configure Connection</h2>
      <p class="subtitle">
        Set the base URL for the SickRock service (leave blank to use the Vite proxy) and authenticate if required.
      </p>
      <form
        class="base-url-form"
        @submit.prevent="handleSubmit"
      >
        <div class="field">
          <input
            id="base-url"
            v-model="baseUrl"
            class="base-url-input"
            type="url"
            inputmode="url"
            placeholder="http://localhost:5234"
            :disabled="isLoading"
          />
        </div>
        <p v-if="baseUrlMissingApiSuffix" class="warning">
          The server URL should end with <code>/api</code> (e.g. <code>https://example.com/api</code>).
        </p>
        <div v-if="needsAuth" class="auth-fields">
          <div class="field">
            <input
              id="username"
              v-model="username"
              class="base-url-input"
              type="text"
              autocomplete="username"
              placeholder="Username"
              :disabled="isLoading"
            />
          </div>
          <div class="field">
            <input
              id="password"
              v-model="password"
              class="base-url-input"
              type="password"
              autocomplete="current-password"
              placeholder="Password"
              :disabled="isLoading"
            />
          </div>
        </div>
        <p class="hint">
          Leave blank to use the Vite proxy.
          Current endpoint:
          <code>{{ effectiveBaseUrl || 'relative (proxy)' }}</code>
          <span v-if="needsAuth">
            ·
            <template v-if="hasToken">
              Stored bearer token will be used for future requests.
            </template>
            <template v-else>
              Credentials are sent to <code>/Login</code> before fetching data and are not stored.
            </template>
          </span>
        </p>
        <div class="actions">
          <button type="submit" :disabled="isLoading">
            {{ isLoading ? 'Loading…' : 'Apply & Fetch' }}
          </button>
          <button
            type="button"
            class="secondary"
            :disabled="isLoading"
            @click="refreshStatusItems"
          >
            Refresh
          </button>
          <button
            v-if="needsAuth && hasToken"
            type="button"
            class="secondary"
            :disabled="isLoading"
            @click="clearStoredToken"
          >
            Clear Token
          </button>
        </div>
      </form>
    </section>
  </main>
  <footer class="app-footer">
    <p v-if="!showConnectionUI && baseUrlMissingApiSuffix" class="warning footer-warning">
      Server URL should end with <code>/api</code>.
    </p>
    <span class="refresh-indicator" :class="{ refreshing: isLoading }">
      <span class="refresh-indicator-dot" />
      <span>{{ refreshCountdownLabel }}</span>
    </span>
    <button
      type="button"
      class="footer-button"
      :class="{ subtle: !showConnectionUI }"
      :disabled="isLoading"
      @click="showConnectionUI = !showConnectionUI"
    >
      {{ showConnectionUI ? 'Hide connection settings' : 'Configure connection' }}
    </button>
  </footer>
</template>

<style scoped>
.app {
  display: grid;
  place-content: center;
  min-height: 100vh;
  gap: 2rem;
  padding-bottom: 4rem;
  text-align: center;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #1f2933;
  background: linear-gradient(180deg, #f1f5f9 0%, #ffffff 100%);
}

.logo {
  width: 320px;
  height: auto;
  margin: 0 auto;
  transition: transform 0.2s ease, filter 0.2s ease;
}

.logo:hover {
  transform: scale(1.05);
  filter: brightness(1.1);
}
 
.base-url-form {
  display: grid;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.auth-fields {
  display: grid;
  gap: 0.75rem;
}

.field {
  display: grid;
  gap: 0.5rem;
  text-align: left;
}

.base-url-input {
  padding: 0.6rem 0.75rem;
  border: 1px solid rgba(15, 23, 42, 0.15);
  border-radius: 0.75rem;
  font-size: 1rem;
  margin-bottom: 1em;
  text-align: center;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.base-url-input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}

.tags-textarea {
  resize: vertical;
  min-height: 4rem;
}

.hint {
  color: #64748b;
  font-size: 0.9rem;
}

.warning {
  color: #b45309;
  font-size: 0.9rem;
  font-weight: 500;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}

button {
  border: none;
  border-radius: 0.75rem;
  padding: 0.55rem 1.2rem;
  font-weight: 600;
  cursor: pointer;
  background: #2563eb;
  color: #ffffff;
  transition: background 0.2s ease, transform 0.2s ease;
}

button:hover:enabled {
  background: #1d4ed8;
  transform: translateY(-1px);
}

button:disabled {
  cursor: not-allowed;
  background: rgba(37, 99, 235, 0.5);
}

button.secondary {
  background: rgba(15, 23, 42, 0.08);
  color: #1f2933;
}

button.secondary:hover:enabled {
  background: rgba(15, 23, 42, 0.12);
}

button.tertiary {
  background: transparent;
  color: #2563eb;
  border: 1px solid rgba(37, 99, 235, 0.35);
}

button.tertiary:hover:enabled {
  background: rgba(37, 99, 235, 0.08);
}

button.danger {
  background: #ef4444;
  color: #ffffff;
}

button.danger:hover:enabled {
  background: #dc2626;
  transform: translateY(-1px);
}

code {
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  background-color: rgba(15, 23, 42, 0.08);
}

.card {
  max-width: 480px;
  margin: 0 auto;
  padding: 1.5rem;
  border-radius: 1rem;
  background: #ffffff;
  box-shadow: 0 4px 20px rgba(15, 23, 42, 0.1);
  text-align: left;
}

.card h2 {
  margin-top: 0;
}

.connection-card {
  margin-top: 1.5rem;
}

.results-card {
  display: grid;
  gap: 1rem;
}

.filter-field {
  margin-bottom: 0.25rem;
  width: 100%;
}

.filter-input {
  margin-bottom: 0;
  width: 100%;
  box-sizing: border-box;
  text-align: center;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.subtitle {
  color: #475569;
  margin-bottom: 1rem;
}

.info {
  color: #475569;
}

.remaining-items {
  margin-top: 0.85rem;
  text-align: center;
  font-size: 0.85rem;
  color: #94a3b8;
  letter-spacing: 0.01em;
}

.error {
  color: #e11d48;
}

.items-list {
  display: grid;
  gap: 0.75rem;
  padding: 0;
  margin: 0;
  list-style: none;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.items-list-entry {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1rem;
  background: #f8fafc;
  padding: 0.9rem 1.15rem;
  border-radius: 0.85rem;
  border: 1px solid rgba(37, 99, 235, 0.12);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  cursor: pointer;
}

.items-list-entry:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
}

.items-list-entry.karma-positive {
  border-color: rgba(34, 197, 94, 0.35);
  background: linear-gradient(135deg, rgba(240, 253, 244, 0.9), rgba(240, 253, 244, 0.65));
}

.items-list-entry.karma-warning {
  border-color: rgba(234, 179, 8, 0.35);
  background: linear-gradient(135deg, rgba(254, 243, 199, 0.95), rgba(254, 240, 138, 0.65));
}

.items-list-entry.karma-negative {
  border-color: rgba(239, 68, 68, 0.35);
  background: linear-gradient(135deg, rgba(254, 226, 226, 0.95), rgba(254, 205, 211, 0.65));
  box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.12);
}

.item-body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
}

.item-content {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1;
}

.item-name {
  font-size: 1.05rem;
  font-weight: 600;
  color: #1f2933;
}

.item-suggestion {
  font-size: 0.9rem;
  color: #64748b;
  font-style: italic;
}

.item-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.35rem;
}

.item-tag {
  display: inline-flex;
  align-items: center;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.3rem 0.75rem;
  border-radius: 0.4rem;
  letter-spacing: 0.02em;
}

.item-tag-key--has-value {
  border-right: 1px solid var(--tag-separator-color);
  padding-right: 0.35rem;
  margin-right: 0.35rem;
}

.item-karma {
  margin-left: auto;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.1);
  color: #2563eb;
}

.item-karma.karma-positive {
  background: rgba(34, 197, 94, 0.18);
  color: #166534;
}

.item-karma.karma-warning {
  background: rgba(234, 179, 8, 0.18);
  color: #92400e;
}

.item-karma.karma-negative {
  background: rgba(239, 68, 68, 0.18);
  color: #991b1b;
}

.app-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  pointer-events: none;
}

.footer-button {
  pointer-events: auto;
  background: rgba(15, 23, 42, 0.12);
  color: #1f2933;
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.1);
}

.footer-button.subtle {
  background: rgba(15, 23, 42, 0.05);
  border-color: rgba(15, 23, 42, 0.05);
  box-shadow: none;
}

.footer-warning {
  margin: 0;
  font-size: 0.8rem;
  pointer-events: auto;
}

.refresh-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-family: sans-serif;
  color: #475569;
  opacity: 0.85;
  pointer-events: auto;
}

.refresh-indicator-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: #2563eb;
  animation: indicatorPulse 2s ease-in-out infinite;
}

.refresh-indicator.refreshing .refresh-indicator-dot {
  animation: indicatorPulse 1s ease-in-out infinite;
}

@keyframes indicatorPulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.8;
  }

  50% {
    transform: scale(1.4);
    opacity: 1;
  }
}

@keyframes otto-hover {
  0%, 100% {
    transform: translate(40px, 24px);
  }

  50% {
    transform: translate(40px, 8px);
  }
}

.logo :deep(.otto-hover) {
  transform: translate(40px, 24px);
  transform-box: fill-box;
  transform-origin: center;
  animation: otto-hover 2s ease-in-out infinite;
}

@keyframes eye-wander {
  0%, 100% {
    transform: translate(0, 2px);
  }
  10% {
    transform: translate(1px, 3px);
  }
  20% {
    transform: translate(-1px, 3px);
  }
  30% {
    transform: translate(2px, 2px);
  }
  40% {
    transform: translate(-2px, 2px);
  }
  50% {
    transform: translate(0, 3px);
  }
  60% {
    transform: translate(1px, 2px);
  }
  70% {
    transform: translate(-1px, 1px);
  }
  80% {
    transform: translate(2px, 1px);
  }
  90% {
    transform: translate(-2px, 3px);
  }
}

.logo :deep(.pupil) {
  transform-origin: center;
  animation: eye-wander 8s ease-in-out infinite;
}

.edit-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.edit-modal {
  background: #dee3e7;
  border-radius: 1rem;
  padding: 1.5rem;
  max-width: 400px;
  width: 100%;
  box-shadow: 0 8px 32px rgba(15, 23, 42, 0.2);
}

.edit-modal h3 {
  margin-top: 0;
  margin-bottom: 1rem;
}

.delete-confirmation-text {
  margin: 1rem 0;
  color: #1f2933;
  font-size: 1rem;
}

.delete-warning {
  margin: 0.5rem 0 1.5rem 0;
  color: #ef4444;
  font-size: 0.9rem;
  font-weight: 600;
}
</style>
