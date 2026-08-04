export type StorageAdapter = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
};

export class MemoryStorage implements StorageAdapter {
  #items = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    const value = this.#items.get(key);
    return value === undefined ? null : value;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.#items.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.#items.delete(key);
  }

  async clear(): Promise<void> {
    this.#items.clear();
  }
}
