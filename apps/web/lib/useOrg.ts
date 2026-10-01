'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useI18n } from './i18n';

export interface Department {
  id: string;
  nameRu: string;
  nameKk: string;
  parentId: string | null;
}
export interface Position {
  id: string;
  nameRu: string;
  nameKk: string;
}

/** Loads departments and positions and resolves their names in the current language. */
export function useOrg() {
  const { locale } = useI18n();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);

  const reload = useCallback(async () => {
    const [d, p] = await Promise.all([api<Department[]>('/departments'), api<Position[]>('/positions')]);
    setDepartments(d);
    setPositions(p);
  }, []);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  const name = (o: { nameRu: string; nameKk: string }) => (locale === 'kk' ? o.nameKk : o.nameRu);
  return {
    departments,
    positions,
    reload,
    name,
    department: (id: string | null) => {
      const d = departments.find((x) => x.id === id);
      return d ? name(d) : undefined;
    },
    position: (id: string | null) => {
      const p = positions.find((x) => x.id === id);
      return p ? name(p) : undefined;
    },
  };
}
