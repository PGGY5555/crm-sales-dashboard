/**
 * Shopnex CRM API client
 * Proxies requests to https://www.shopnex.tw/api-public/v1
 */
import axios, { AxiosInstance } from "axios";

const BASE_URL = "https://www.shopnex.tw/api-public/v1";

export function createShopnexClient(apiToken: string, appName: string): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "g-app": appName,
    },
    timeout: 30000,
  });
}

export interface ShopnexUserListParams {
  page?: number;
  limit?: number;
  only_id?: boolean;
  searchType?: "name" | "email" | "phone" | "lineID" | "fb-id";
  search?: string;
}

export interface ShopnexOrderListParams {
  page?: number;
  limit?: number;
  orderString?: "created_time_desc" | "created_time_asc" | "order_total_desc" | "order_total_asc";
  searchType?: string;
  search?: string;
  archived?: boolean;
  is_shipment?: boolean;
}

export interface ShopnexProductListParams {
  page?: number;
  limit?: number;
  productType?: "product" | "addProduct" | "giveaway" | "hidden";
  filter_visible?: boolean;
  searchType?: "title" | "sku" | "barcode";
  search?: string;
}

export class ShopnexAPI {
  private client: AxiosInstance;

  constructor(apiToken: string, appName: string) {
    this.client = createShopnexClient(apiToken, appName);
  }

  /** Fetch customer list */
  async getUsers(params: ShopnexUserListParams = {}) {
    const { data } = await this.client.get("/user", {
      params: {
        type: "list",
        page: params.page ?? 0,
        limit: params.limit ?? 50,
        only_id: params.only_id ?? false,
        ...(params.searchType && { searchType: params.searchType }),
        ...(params.search && { search: params.search }),
      },
    });
    return data;
  }

  /** Fetch single customer by email or phone */
  async getUserByContact(search: string) {
    const { data } = await this.client.get("/user", {
      params: {
        type: "email_or_phone",
        search,
      },
    });
    return data;
  }

  /** Fetch order list */
  async getOrders(params: ShopnexOrderListParams = {}) {
    const { data } = await this.client.get("/ec/order", {
      params: {
        page: params.page ?? 0,
        limit: params.limit ?? 50,
        orderString: params.orderString ?? "created_time_desc",
        ...(params.searchType && { searchType: params.searchType }),
        ...(params.search && { search: params.search }),
        ...(params.archived !== undefined && { archived: params.archived }),
        ...(params.is_shipment !== undefined && { is_shipment: params.is_shipment }),
      },
    });
    return data;
  }

  /** Fetch product list */
  async getProducts(params: ShopnexProductListParams = {}) {
    const { data } = await this.client.get("/ec/product", {
      params: {
        page: params.page ?? 0,
        limit: params.limit ?? 50,
        productType: params.productType ?? "product",
        ...(params.filter_visible !== undefined && { filter_visible: params.filter_visible }),
        ...(params.searchType && { searchType: params.searchType }),
        ...(params.search && { search: params.search }),
      },
    });
    return data;
  }

  /** Fetch all users with pagination */
  async getAllUsers(limit = 50): Promise<any[]> {
    const allUsers: any[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      try {
        const result = await this.getUsers({ page, limit, only_id: false });
        const items = result?.data ?? result?.users ?? result ?? [];
        if (Array.isArray(items) && items.length > 0) {
          allUsers.push(...items);
          if (items.length < limit) hasMore = false;
          else page++;
        } else {
          hasMore = false;
        }
      } catch (e) {
        console.error(`[Shopnex] Error fetching users page ${page}:`, e);
        hasMore = false;
      }
    }
    return allUsers;
  }

  /** Fetch all orders with pagination */
  async getAllOrders(limit = 50): Promise<any[]> {
    const allOrders: any[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      try {
        const result = await this.getOrders({ page, limit });
        const items = result?.data ?? result?.orders ?? result ?? [];
        if (Array.isArray(items) && items.length > 0) {
          allOrders.push(...items);
          if (items.length < limit) hasMore = false;
          else page++;
        } else {
          hasMore = false;
        }
      } catch (e) {
        console.error(`[Shopnex] Error fetching orders page ${page}:`, e);
        hasMore = false;
      }
    }
    return allOrders;
  }
}
