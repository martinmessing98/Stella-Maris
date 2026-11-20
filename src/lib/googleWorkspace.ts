import { formatPhoneNumber } from './formatters';
import type { ClientContact, GoogleCalendarEvent } from '../types';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const PEOPLE_API = 'https://people.googleapis.com/v1';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export class WorkspaceAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceAuthError';
  }
}

async function wsFetch(url: string, accessToken: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (res.status === 401) {
    throw new WorkspaceAuthError('Google Workspace session expired. Please sign in again.');
  }
  return res;
}

// ==================== GOOGLE CALENDAR ====================

export async function listCalendarEvents(
  accessToken: string,
  timeMinIso: string,
  timeMaxIso: string
): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
    maxResults: '100',
  });
  const res = await wsFetch(`${CALENDAR_API}/calendars/primary/events?${params.toString()}`, accessToken);
  if (!res.ok) {
    throw new Error(`Calendar fetch failed (${res.status})`);
  }
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      description?: string;
      location?: string;
      htmlLink?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;
  };
  return (data.items || []).map((ev) => ({
    id: ev.id,
    summary: ev.summary || '(Untitled Event)',
    description: ev.description,
    location: ev.location,
    htmlLink: ev.htmlLink,
    start: ev.start?.dateTime || ev.start?.date || '',
    end: ev.end?.dateTime || ev.end?.date || '',
    allDay: Boolean(ev.start?.date && !ev.start?.dateTime),
  }));
}

export async function createCalendarEvent(
  accessToken: string,
  payload: {
    summary: string;
    description?: string;
    location?: string;
    startDateTime: string;
    endDateTime: string;
  }
): Promise<{ id: string; htmlLink?: string }> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
  const res = await wsFetch(`${CALENDAR_API}/calendars/primary/events`, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: payload.summary,
      description: payload.description,
      location: payload.location,
      start: { dateTime: payload.startDateTime, timeZone: tz },
      end: { dateTime: payload.endDateTime, timeZone: tz },
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create Calendar event (${res.status})`);
  }
  return res.json();
}

export async function updateCalendarEvent(
  accessToken: string,
  eventId: string,
  payload: {
    summary: string;
    description?: string;
    location?: string;
    startDateTime: string;
    endDateTime: string;
  }
): Promise<{ id: string; htmlLink?: string }> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
  const res = await wsFetch(`${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`, accessToken, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: payload.summary,
      description: payload.description,
      location: payload.location,
      start: { dateTime: payload.startDateTime, timeZone: tz },
      end: { dateTime: payload.endDateTime, timeZone: tz },
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to update Calendar event (${res.status})`);
  }
  return res.json();
}

export async function deleteCalendarEvent(accessToken: string, eventId: string): Promise<void> {
  const res = await wsFetch(`${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`, accessToken, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete Calendar event (${res.status})`);
  }
}

// ==================== GOOGLE CONTACTS (PEOPLE API) ====================

export async function listGoogleContacts(accessToken: string): Promise<ClientContact[]> {
  const params = new URLSearchParams({
    personFields: 'names,emailAddresses,phoneNumbers,addresses,organizations',
    pageSize: '150',
  });
  const res = await wsFetch(`${PEOPLE_API}/people/me/connections?${params.toString()}`, accessToken);
  if (!res.ok) {
    throw new Error(`Contacts fetch failed (${res.status})`);
  }
  const data = (await res.json()) as {
    connections?: Array<{
      resourceName: string;
      names?: Array<{ displayName?: string }>;
      emailAddresses?: Array<{ value?: string }>;
      phoneNumbers?: Array<{ value?: string }>;
      addresses?: Array<{ formattedValue?: string }>;
      organizations?: Array<{ name?: string }>;
    }>;
  };
  return (data.connections || [])
    .filter((p) => p.names?.[0]?.displayName)
    .map((p) => ({
      id: p.resourceName,
      googleResourceName: p.resourceName,
      name: p.names?.[0]?.displayName || 'Unnamed Contact',
      phone: formatPhoneNumber(p.phoneNumbers?.[0]?.value || ''),
      email: p.emailAddresses?.[0]?.value || '',
      address: p.addresses?.[0]?.formattedValue || '',
      company: p.organizations?.[0]?.name || '',
      syncState: 'synced' as const,
    }));
}

export async function createGoogleContact(
  accessToken: string,
  contact: Omit<ClientContact, 'id' | 'syncState' | 'googleResourceName'>
): Promise<ClientContact> {
  const parts = contact.name.trim().split(/\s+/);
  const givenName = parts[0] || contact.name;
  const familyName = parts.slice(1).join(' ');

  const res = await wsFetch(`${PEOPLE_API}/people:createContact`, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      names: [{ givenName, familyName }],
      phoneNumbers: contact.phone ? [{ value: contact.phone, type: 'mobile' }] : undefined,
      emailAddresses: contact.email ? [{ value: contact.email, type: 'work' }] : undefined,
      addresses: contact.address ? [{ formattedValue: contact.address, type: 'home' }] : undefined,
      organizations: contact.company ? [{ name: contact.company }] : undefined,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create Google Contact (${res.status})`);
  }
  const created = (await res.json()) as { resourceName: string };
  return {
    ...contact,
    id: created.resourceName,
    googleResourceName: created.resourceName,
    syncState: 'synced',
  };
}

// ==================== GOOGLE DRIVE & PHOTOS STORAGE ====================

async function findOrCreateFolder(accessToken: string, name: string, parentId?: string): Promise<string> {
  const escaped = name.replace(/'/g, "\\'");
  const qParts = [
    `name = '${escaped}'`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    'trashed = false',
  ];
  if (parentId) {
    qParts.push(`'${parentId}' in parents`);
  }
  const searchParams = new URLSearchParams({
    q: qParts.join(' and '),
    fields: 'files(id, name)',
    pageSize: '1',
  });
  const searchRes = await wsFetch(`${DRIVE_API}/files?${searchParams.toString()}`, accessToken);
  if (searchRes.ok) {
    const searchData = (await searchRes.json()) as { files?: Array<{ id: string }> };
    if (searchData.files?.[0]?.id) {
      return searchData.files[0].id;
    }
  }

  const createRes = await wsFetch(`${DRIVE_API}/files`, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Failed to create Drive folder (${createRes.status})`);
  }
  const folder = (await createRes.json()) as { id: string };
  return folder.id;
}

export async function ensureJobDriveFolder(accessToken: string, jobLabel: string): Promise<string> {
  const rootId = await findOrCreateFolder(accessToken, 'FieldLedger Job Files & Photos');
  return findOrCreateFolder(accessToken, jobLabel, rootId);
}

export async function uploadFileToDrive(
  accessToken: string,
  fileBlob: Blob,
  fileName: string,
  mimeType: string,
  folderId: string
): Promise<{ id: string; webViewLink?: string; thumbnailLink?: string }> {
  const metadata = {
    name: fileName,
    parents: [folderId],
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', fileBlob, fileName);

  const res = await wsFetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,webViewLink,thumbnailLink`,
    accessToken,
    {
      method: 'POST',
      body: form,
    }
  );
  if (!res.ok) {
    throw new Error(`Drive upload failed (${res.status})`);
  }
  return res.json();
}

export async function deleteDriveFile(accessToken: string, fileId: string): Promise<void> {
  const res = await wsFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, accessToken, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Drive delete failed (${res.status})`);
  }
}

export async function listGoogleDrivePhotos(accessToken: string): Promise<
  Array<{
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    thumbnailLink?: string;
    webViewLink?: string;
    createdTime?: string;
  }>
> {
  const params = new URLSearchParams({
    q: "mimeType contains 'image/' and trashed = false",
    fields: 'files(id,name,mimeType,size,thumbnailLink,webViewLink,createdTime)',
    orderBy: 'createdTime desc',
    pageSize: '36',
  });
  const res = await wsFetch(`${DRIVE_API}/files?${params.toString()}`, accessToken);
  if (!res.ok) {
    throw new Error(`Failed to browse photos (${res.status})`);
  }
  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      thumbnailLink?: string;
      webViewLink?: string;
      createdTime?: string;
    }>;
  };
  return data.files || [];
}
