import { create, type MessageInitShape } from '@bufbuild/protobuf';
import {
  ListItemsRequestSchema,
  SickRock,
} from '../gen/sickrock_pb.js';
import type {
  Item,
  ListItemsRequest,
  ListItemsResponse,
} from '../gen/sickrock_pb.js';

export type { Item, ListItemsRequest, ListItemsResponse } from '../gen/sickrock_pb.js';
export const SickRockService = SickRock;

export const createListItemsRequest = (
  init: MessageInitShape<typeof ListItemsRequestSchema> = {},
) => create(ListItemsRequestSchema, init);

