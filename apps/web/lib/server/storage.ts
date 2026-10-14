import "server-only"
import { createStorage, storageEnvFrom, type Storage } from "@vidora/storage"

const g = globalThis as unknown as { __vidoraStorage?: Storage }
export function getStorage(): Storage {
  g.__vidoraStorage ??= createStorage(storageEnvFrom(process.env))
  return g.__vidoraStorage
}
