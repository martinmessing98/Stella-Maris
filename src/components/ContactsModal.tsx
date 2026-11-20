import React, { useState } from 'react';
import { Mail, MapPin, Phone, Plus, RefreshCw, Search, Trash2, UserCheck, X } from 'lucide-react';
import { formatPhoneInput, formatPhoneNumber, getGoogleMapsUrl, getTelHref } from '../lib/formatters';
import type { ClientContact } from '../types';

interface ContactsModalProps {
  open: boolean;
  contacts: ClientContact[];
  googleConnected: boolean;
  isOnline: boolean;
  isSyncing: boolean;
  onClose: () => void;
  onSyncFromGoogle: () => Promise<void>;
  onCreateContact: (contact: Omit<ClientContact, 'id' | 'syncState' | 'googleResourceName'>, syncToGoogle: boolean) => Promise<void>;
  onDeleteContact?: (contact: ClientContact) => void;
  onClearAllContacts?: () => void;
  onSelectContact?: (contact: ClientContact) => void;
}

export const ContactsModal: React.FC<ContactsModalProps> = ({
  open,
  contacts,
  googleConnected,
  isOnline,
  isSyncing,
  onClose,
  onSyncFromGoogle,
  onCreateContact,
  onDeleteContact,
  onClearAllContacts,
  onSelectContact,
}) => {
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [company, setCompany] = useState('');
  const [saveToGoogle, setSaveToGoogle] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const filtered = contacts.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      c.address.toLowerCase().includes(q)
    );
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await onCreateContact(
        {
          name: name.trim(),
          phone: formatPhoneNumber(phone),
          email: email.trim(),
          address: address.trim(),
          company: company.trim() || undefined,
        },
        saveToGoogle && googleConnected
      );
      setName('');
      setPhone('');
      setEmail('');
      setAddress('');
      setCompany('');
      setShowAdd(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">Contacts</h2>
            <p className="text-xs text-slate-500">
              Auto-synced from Job Orders &amp; Cloud · {contacts.length} contact{contacts.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {googleConnected && isOnline && (
              <button
                type="button"
                onClick={onSyncFromGoogle}
                disabled={isSyncing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                Pull Google Contacts
              </button>
            )}
            {contacts.length > 0 && onClearAllContacts && (
              <button
                type="button"
                onClick={onClearAllContacts}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 whitespace-nowrap shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear All
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              New Contact
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close contacts"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {showAdd && (
          <form onSubmit={handleCreate} className="border-b border-slate-200 bg-slate-50 px-6 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">Full Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jordan Alvarez"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Phone Number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                  placeholder="503-555-0199"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jordan@example.com"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Company (Optional)</label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Homeowner or Property Mgmt"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700">Site / Billing Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="1245 Oakwood Dr, Portland, OR"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-600 focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={saveToGoogle}
                  onChange={(e) => setSaveToGoogle(e.target.checked)}
                  disabled={!googleConnected}
                  className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-600"
                />
                {googleConnected
                  ? 'Also save to Google Contacts (queues automatically if offline)'
                  : 'Sign in with Google to sync directly to Google Contacts'}
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {submitting ? 'Saving...' : 'Save Contact'}
                </button>
              </div>
            </div>
          </form>
        )}

        <div className="border-b border-slate-100 px-6 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts by name, phone, email, or street..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-amber-600 focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 px-6">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              {contacts.length === 0
                ? 'No contacts yet. Creating a job order will automatically sync its client here.'
                : 'No matching contacts found.'}
            </div>
          ) : (
            filtered.map((contact) => (
              <div key={contact.id} className="flex flex-wrap items-center justify-between gap-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{contact.name}</span>
                    {contact.company && (
                      <>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="text-xs text-slate-500">{contact.company}</span>
                      </>
                    )}
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span
                      className={`text-xs font-medium ${
                        contact.googleResourceName
                          ? 'text-emerald-700'
                          : contact.syncState === 'pending'
                          ? 'text-amber-700'
                          : 'text-slate-500'
                      }`}
                    >
                      {contact.googleResourceName
                        ? 'Google Contact'
                        : contact.syncState === 'pending'
                        ? 'Queued for Google'
                        : 'Saved Contact'}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                    {getTelHref(contact.phone) && (
                      <a
                        href={getTelHref(contact.phone)}
                        className="inline-flex items-center gap-1 font-mono tabular-nums text-emerald-700 hover:underline"
                      >
                        <Phone className="h-3 w-3" />
                        {formatPhoneNumber(contact.phone)}
                      </a>
                    )}
                    {contact.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3 text-slate-400" />
                        {contact.email}
                      </span>
                    )}
                    {getGoogleMapsUrl(contact.address) && (
                      <a
                        href={getGoogleMapsUrl(contact.address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-amber-700 hover:underline"
                      >
                        <MapPin className="h-3 w-3" />
                        {contact.address}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {onSelectContact && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectContact(contact);
                        onClose();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:border-amber-500 hover:bg-amber-50 hover:text-amber-900 whitespace-nowrap"
                    >
                      <UserCheck className="h-3.5 w-3.5" />
                      Select Contact
                    </button>
                  )}
                  {onDeleteContact && (
                    <button
                      type="button"
                      onClick={() => onDeleteContact(contact)}
                      className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      aria-label={`Delete ${contact.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
