'use client';

import { createContext, useContext } from 'react';

/** Where attachment bytes are fetched from: the ordinary member route, or the audited management route. */
const Ctx = createContext('/attachments');
export const AttachmentBaseProvider = Ctx.Provider;
export const useAttachmentBase = () => useContext(Ctx);
