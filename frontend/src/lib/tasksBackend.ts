import { create } from '@bufbuild/protobuf';
import type {
  CreateItemRequest,
  CreateItemResponse,
  DeleteItemRequest,
  DeleteItemResponse,
  EditItemRequest,
  EditItemResponse,
  InitRequest,
  InitResponse,
  ListItemsRequest,
  ListItemsResponse,
  LoginRequest,
  LoginResponse,
} from '../gen/sickrock_pb.js';
import type { Item } from '../gen/sickrock_pb.js';
import {
  CreateItemResponseSchema,
  DeleteItemResponseSchema,
  EditItemResponseSchema,
  InitResponseSchema,
  ItemSchema,
  ListItemsResponseSchema,
  LoginResponseSchema,
} from '../gen/sickrock_pb.js';
import {
  appendLineToDoneFile,
  getBackupDirectoryWithPermission,
  readTodoFile,
  writeTodoFile,
} from './filesystemBackend.js';
import {
  additionalFieldsFromParsedTask,
  formatTask,
  parseFile,
  parsedTaskFromItem,
  type ParsedTask,
} from './todotxt.js';

/** Supported task backends. */
export type TasksBackendType = 'connectrpc' | 'filesystem';

export const TASKS_BACKEND_STORAGE_KEY = 'otto-tasks-backend';

function parsedTaskToItem(task: ParsedTask): Item {
  return create(ItemSchema, {
    id: task.id,
    srCreated: BigInt(0),
    srCreatedRelative: 0,
    srUpdated: BigInt(0),
    srUpdatedRelative: 0,
    additionalFields: additionalFieldsFromParsedTask(task),
  });
}

/**
 * Filesystem client that reads/writes todo.txt (todotxt.org format) via the File System Access API.
 */
export function createFilesystemClient(): TasksClient {
  return {
    async init(_req: InitRequest): Promise<InitResponse> {
      return create(InitResponseSchema, {
        version: '',
        commit: '',
        date: '',
        dbName: '',
      });
    },

    async login(_req: LoginRequest): Promise<LoginResponse> {
      return create(LoginResponseSchema, {
        success: false,
        message: 'Local filesystem backend does not use login.',
        token: '',
        expiresAt: BigInt(0),
      });
    },

    async listItems(req: ListItemsRequest): Promise<ListItemsResponse> {
      const dir = await getBackupDirectoryWithPermission();
      if (!dir) {
        return create(ListItemsResponseSchema, { items: [] });
      }
      const content = await readTodoFile(dir);
      const tasks = parseFile(content);

      if (req.tcName === 'projects') {
        const projectNames = new Set<string>();
        for (const t of tasks) {
          for (const p of t.projects) projectNames.add(p);
        }
        const projectItems: Item[] = Array.from(projectNames).map((name) =>
          create(ItemSchema, {
            id: name,
            srCreated: BigInt(0),
            srCreatedRelative: 0,
            srUpdated: BigInt(0),
            srUpdatedRelative: 0,
            additionalFields: { name },
          }),
        );
        return create(ListItemsResponseSchema, { items: projectItems });
      }

      // status: pending tasks only (non-completed)
      const pending = tasks.filter((t) => !t.completed);
      const items = pending.map(parsedTaskToItem);
      return create(ListItemsResponseSchema, { items });
    },

    async createItem(req: CreateItemRequest): Promise<CreateItemResponse> {
      const dir = await getBackupDirectoryWithPermission();
      if (!dir) {
        return create(CreateItemResponseSchema, {});
      }
      const content = await readTodoFile(dir);
      const lines = content ? content.split(/\n/).filter((l) => l.trim() !== '') : [];
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `local-${Date.now()}`;
      const created =
        req.additionalFields?.created ??
        new Date().toISOString().slice(0, 10);
      const task = parsedTaskFromItem(id, {
        ...req.additionalFields,
        created,
      });
      const newLine = formatTask(task);
      lines.push(newLine);
      await writeTodoFile(dir, lines.join('\n') + (lines.length ? '\n' : ''));
      const item = parsedTaskToItem(task);
      return create(CreateItemResponseSchema, { item });
    },

    async editItem(req: EditItemRequest): Promise<EditItemResponse> {
      const dir = await getBackupDirectoryWithPermission();
      if (!dir) {
        return create(EditItemResponseSchema, {});
      }
      const content = await readTodoFile(dir);
      const tasks = parseFile(content);
      const index = tasks.findIndex((t) => t.id === req.id);
      if (index === -1) {
        return create(EditItemResponseSchema, {});
      }
      const updated = parsedTaskFromItem(req.id, req.additionalFields);
      updated.completed = tasks[index].completed;
      updated.completionDate = tasks[index].completionDate;
      updated.priority = tasks[index].priority;
      updated.created = tasks[index].created ?? updated.created;
      updated.rawLine = tasks[index].rawLine;
      tasks[index] = updated;
      const lines = tasks.map((t) => formatTask(t));
      await writeTodoFile(dir, lines.join('\n') + '\n');
      const item = parsedTaskToItem(updated);
      return create(EditItemResponseSchema, { item });
    },

    async deleteItem(req: DeleteItemRequest): Promise<DeleteItemResponse> {
      const dir = await getBackupDirectoryWithPermission();
      if (!dir) {
        return create(DeleteItemResponseSchema, { deleted: false });
      }
      const content = await readTodoFile(dir);
      const tasks = parseFile(content);
      const index = tasks.findIndex((t) => t.id === req.id);
      if (index === -1) {
        return create(DeleteItemResponseSchema, { deleted: false });
      }
      const task = tasks[index];
      const completedDate = new Date().toISOString().slice(0, 10);
      const completedTask: ParsedTask = {
        ...task,
        completed: true,
        completionDate: completedDate,
      };
      const doneLine = formatTask(completedTask);
      await appendLineToDoneFile(dir, doneLine);
      const filtered = tasks.filter((t) => t.id !== req.id);
      const lines = filtered.map((t) => formatTask(t));
      await writeTodoFile(dir, lines.join('\n') + (lines.length ? '\n' : ''));
      return create(DeleteItemResponseSchema, { deleted: true });
    },
  };
}

/** @deprecated Use createFilesystemClient for full todo.txt support. Kept for compatibility. */
export function createFilesystemStubClient(): TasksClient {
  return createFilesystemClient();
}

/** Minimal interface used by the app for task operations. */
export type TasksClient = {
  init(req: InitRequest): Promise<InitResponse>;
  login(req: LoginRequest): Promise<LoginResponse>;
  listItems(req: ListItemsRequest): Promise<ListItemsResponse>;
  createItem(req: CreateItemRequest): Promise<CreateItemResponse>;
  editItem(req: EditItemRequest): Promise<EditItemResponse>;
  deleteItem(req: DeleteItemRequest): Promise<DeleteItemResponse>;
};
