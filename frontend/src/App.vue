<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  createListItemsRequest,
  type Item,
  type ListItemsResponse,
} from './lib/sickrock';
import { createSickRockClient } from './lib/sickrockClient';

const statusItems = ref<Item[]>([]);
const isLoading = ref(true);
const errorMessage = ref<string | null>(null);

const fetchStatusItems = async (): Promise<ListItemsResponse> => {
  const client = createSickRockClient();
  return client.listItems(
    createListItemsRequest({
      tcName: 'status',
      where: {},
    }),
  );
};

onMounted(async () => {
  try {
    const response = await fetchStatusItems();
    statusItems.value = response.items;
  } catch (error) {
    if (error instanceof Error) {
      errorMessage.value = error.message;
    } else {
      errorMessage.value = String(error);
    }
  } finally {
    isLoading.value = false;
  }
});
</script>

<template>
  <main class="app">
    <img
      alt="Otto logo"
      class="logo"
      src="/assets/otto-logo.svg"
    />
    <section class="card">
      <h2>Status Items</h2>
      <p class="subtitle">
        Data fetched via Connect RPC from <code>SickRock.ListItems</code> with <code>tcName="status"</code>.
      </p>
      <p v-if="isLoading" class="info">Loading…</p>
      <p v-else-if="errorMessage" class="error">Request failed: {{ errorMessage }}</p>
      <ul v-else-if="statusItems.length" class="items">
        <li v-for="item in statusItems" :key="item.id">
          <strong>{{ item.id || '(no id)' }}</strong>
          <span v-if="Object.keys(item.additionalFields).length">
            · fields: {{ JSON.stringify(item.additionalFields) }}
          </span>
        </li>
      </ul>
      <p v-else class="info">No items returned.</p>
    </section>
  </main>
</template>

<style scoped>
.app {
  display: grid;
  place-content: center;
  min-height: 100vh;
  gap: 2rem;
  text-align: center;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #1f2933;
  background: linear-gradient(180deg, #f1f5f9 0%, #ffffff 100%);
}

.logo {
  width: 320px;
  height: auto;
  margin: 0 auto;
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

.subtitle {
  color: #475569;
  margin-bottom: 1rem;
}

.info {
  color: #475569;
}

.error {
  color: #e11d48;
}

.items {
  display: grid;
  gap: 0.75rem;
  padding: 0;
  margin: 0;
  list-style: none;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.items li {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
  background: #f8fafc;
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
}
</style>

