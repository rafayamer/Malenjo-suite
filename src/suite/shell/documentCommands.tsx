import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type DependencyList,
  type ReactNode,
} from 'react';

export type DocumentCommandId =
  | 'undo'
  | 'redo'
  | 'export'
  | 'print'
  | 'properties';

export interface DocumentCommand {
  id: DocumentCommandId;
  label: string;
  enabled: boolean;
  shortcut?: string;
  detail?: string;
  run(): void | Promise<void>;
}

interface RegistryValue {
  register(sessionId: string, commands: DocumentCommand[]): () => void;
  commandsFor(sessionId: string | null): DocumentCommand[];
  run(sessionId: string | null, commandId: DocumentCommandId): boolean;
}

const DocumentCommandContext = createContext<RegistryValue | null>(null);

export function DocumentCommandProvider({ children }: { children: ReactNode }) {
  const [registry, setRegistry] = useState<Record<string, DocumentCommand[]>>({});

  const register = useCallback((sessionId: string, commands: DocumentCommand[]) => {
    setRegistry((current) => ({ ...current, [sessionId]: commands }));
    return () => {
      setRegistry((current) => {
        if (!(sessionId in current)) return current;
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
    };
  }, []);

  const commandsFor = useCallback(
    (sessionId: string | null) => sessionId ? registry[sessionId] ?? [] : [],
    [registry],
  );

  const run = useCallback((sessionId: string | null, commandId: DocumentCommandId) => {
    const command = sessionId ? registry[sessionId]?.find((item) => item.id === commandId) : undefined;
    if (!command?.enabled) return false;
    void command.run();
    return true;
  }, [registry]);

  const value = useMemo<RegistryValue>(() => ({ register, commandsFor, run }), [commandsFor, register, run]);
  return <DocumentCommandContext.Provider value={value}>{children}</DocumentCommandContext.Provider>;
}

export function useDocumentCommandRegistry(): RegistryValue {
  const value = useContext(DocumentCommandContext);
  if (!value) throw new Error('Document command registry is unavailable outside DocumentCommandProvider.');
  return value;
}

export function useRegisterDocumentCommands(
  sessionId: string | null | undefined,
  factory: () => DocumentCommand[],
  dependencies: DependencyList,
): void {
  const { register } = useDocumentCommandRegistry();
  // The caller controls dependencies so handlers capture a coherent workspace state snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const commands = useMemo(factory, dependencies);

  useEffect(() => {
    if (!sessionId) return;
    return register(sessionId, commands);
  }, [commands, register, sessionId]);
}
