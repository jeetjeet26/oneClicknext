'use client'

import { Users, ArrowRight, ArrowLeft, Plus, Trash2, User, Mail, Phone, Briefcase, CreditCard } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useOnboarding } from '../components/OnboardingProvider'
import { ContactData, ContactType, BillingMethod } from '../types'

const CONTACT_TYPES: { value: ContactType; label: string }[] = [
  { value: 'primary', label: 'Primary Contact' },
  { value: 'secondary', label: 'Secondary Contact' },
  { value: 'billing', label: 'Billing Contact' },
]

const BILLING_METHODS: { value: BillingMethod; label: string }[] = [
  { value: 'ops_merchant', label: 'Ops Merchant' },
  { value: 'nexus', label: 'Nexus' },
  { value: 'ach', label: 'ACH' },
  { value: 'check', label: 'Check' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'other', label: 'Other' },
]

const ROLE_SUGGESTIONS = [
  'Property Manager',
  'Regional Manager',
  'Marketing Manager',
  'Owner',
  'Asset Manager',
  'Leasing Manager',
  'Accounts Payable',
  'Controller',
]

function generateId() {
  return Math.random().toString(36).substring(2, 9)
}

function ContactCard({ 
  contact, 
  onUpdate, 
  onRemove, 
  canRemove 
}: { 
  contact: ContactData
  onUpdate: (data: Partial<ContactData>) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const isBilling = contact.type === 'billing'
  const [showRoleSuggestions, setShowRoleSuggestions] = useState(false)

  return (
    <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <select
          value={contact.type}
          onChange={(e) => onUpdate({ type: e.target.value as ContactType })}
          className="px-3 py-1.5 bg-slate-900/50 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        >
          {CONTACT_TYPES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-1.5">
            <User size={12} />
            Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={contact.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="Jane Smith"
            className="w-full px-3 py-2.5 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
          />
        </div>
        <div className="relative">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-1.5">
            <Briefcase size={12} />
            Role
          </label>
          <input
            type="text"
            value={contact.role}
            onChange={(e) => onUpdate({ role: e.target.value })}
            onFocus={() => setShowRoleSuggestions(true)}
            onBlur={() => setTimeout(() => setShowRoleSuggestions(false), 200)}
            placeholder="Property Manager"
            className="w-full px-3 py-2.5 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
          />
          {showRoleSuggestions && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
              {ROLE_SUGGESTIONS.filter(r => 
                r.toLowerCase().includes(contact.role.toLowerCase()) || !contact.role
              ).slice(0, 5).map(role => (
                <button
                  key={role}
                  type="button"
                  onMouseDown={() => onUpdate({ role })}
                  className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  {role}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-1.5">
            <Mail size={12} />
            Email <span className="text-red-400">*</span>
          </label>
          <input
            type="email"
            value={contact.email}
            onChange={(e) => onUpdate({ email: e.target.value })}
            placeholder="jane@property.com"
            className="w-full px-3 py-2.5 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
          />
        </div>
        <div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-1.5">
            <Phone size={12} />
            Phone
          </label>
          <input
            type="tel"
            value={contact.phone}
            onChange={(e) => onUpdate({ phone: e.target.value })}
            placeholder="(208) 555-1234"
            className="w-full px-3 py-2.5 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all"
          />
        </div>
      </div>

      {/* Billing-specific fields */}
      {isBilling && (
        <>
          <div className="pt-2 border-t border-slate-700">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-2">
              <CreditCard size={12} />
              Billing Method
            </label>
            <div className="grid grid-cols-3 gap-2">
              {BILLING_METHODS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onUpdate({ billingMethod: value })}
                  className={`
                    px-3 py-2 rounded-lg text-xs font-medium transition-all
                    ${contact.billingMethod === value
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600'
                    }
                  `}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">
              Billing Address
            </label>
            <input
              type="text"
              value={contact.billingAddress?.street || ''}
              onChange={(e) => onUpdate({ 
                billingAddress: { 
                  ...contact.billingAddress || { city: '', state: '', zip: '' },
                  street: e.target.value 
                }
              })}
              placeholder="123 Billing St"
              className="w-full px-3 py-2.5 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 mb-2"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={contact.billingAddress?.city || ''}
                onChange={(e) => onUpdate({ 
                  billingAddress: { 
                    ...contact.billingAddress || { street: '', state: '', zip: '' },
                    city: e.target.value 
                  }
                })}
                placeholder="City"
                className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-xs placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
              <input
                type="text"
                value={contact.billingAddress?.state || ''}
                onChange={(e) => onUpdate({ 
                  billingAddress: { 
                    ...contact.billingAddress || { street: '', city: '', zip: '' },
                    state: e.target.value 
                  }
                })}
                placeholder="State"
                className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-xs placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
              <input
                type="text"
                value={contact.billingAddress?.zip || ''}
                onChange={(e) => onUpdate({ 
                  billingAddress: { 
                    ...contact.billingAddress || { street: '', city: '', state: '' },
                    zip: e.target.value 
                  }
                })}
                placeholder="ZIP"
                className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-xs placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={contact.needsW9 || false}
                onChange={(e) => onUpdate({ needsW9: e.target.checked })}
                className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-amber-500 focus:ring-amber-500/50"
              />
              <span className="text-xs text-slate-400">Needs W9</span>
            </label>
          </div>
        </>
      )}

      <div>
        <label className="text-xs font-medium text-slate-400 mb-1.5 block">
          Special Instructions
        </label>
        <textarea
          value={contact.specialInstructions || ''}
          onChange={(e) => onUpdate({ specialInstructions: e.target.value })}
          placeholder="Any special notes about this contact..."
          rows={2}
          className="w-full px-3 py-2.5 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-none"
        />
      </div>
    </div>
  )
}

export function ContactsStep() {
  const { formData, addContact, updateContact, removeContact, error, setError, goToNextStep, goToPreviousStep } = useOnboarding()
  const { contacts } = formData

  useEffect(() => {
    if (contacts.length > 0) {
      return
    }

    addContact({
      id: generateId(),
      type: 'primary',
      name: '',
      email: '',
      phone: '',
      role: ''
    })
  }, [contacts.length, addContact])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validate primary contact
    const primary = contacts.find(c => c.type === 'primary')
    if (!primary || !primary.name.trim() || !primary.email.trim()) {
      setError('Primary contact name and email are required')
      return
    }

    // Validate email format for all contacts
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    for (const contact of contacts) {
      if (contact.email && !emailRegex.test(contact.email)) {
        setError(`Invalid email format for ${contact.name || contact.type}`)
        return
      }
    }

    setError(null)
    goToNextStep()
  }

  const handleAddContact = () => {
    const existingTypes = contacts.map(c => c.type)
    let newType: ContactType = 'secondary'
    
    if (!existingTypes.includes('billing')) {
      newType = 'billing'
    } else if (!existingTypes.includes('secondary')) {
      newType = 'secondary'
    }

    addContact({
      id: generateId(),
      type: newType,
      name: '',
      email: '',
      phone: '',
      role: ''
    })
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-xl shadow-violet-500/25 mb-6">
          <Users className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-3">
          Contact Information
        </h1>
        <p className="text-slate-400 text-lg">
          Add key contacts for this community
        </p>
      </div>

      <div className="bg-slate-800/40 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl p-6 sm:p-8">
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            {contacts.map((contact) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                onUpdate={(data) => updateContact(contact.id, data)}
                onRemove={() => removeContact(contact.id)}
                canRemove={contacts.length > 1}
              />
            ))}
          </div>

          {contacts.length < 4 && (
            <button
              type="button"
              onClick={handleAddContact}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-600 text-slate-400 rounded-xl hover:border-violet-500/50 hover:text-violet-300 transition-all"
            >
              <Plus size={18} />
              Add another contact
            </button>
          )}

          {/* Navigation Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={goToPreviousStep}
              className="flex items-center justify-center gap-2 px-6 py-3.5 bg-slate-700/50 text-slate-300 font-medium rounded-xl hover:bg-slate-700 transition-all"
            >
              <ArrowLeft size={18} />
              Back
            </button>
            <button
              type="submit"
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-violet-500 to-purple-600 text-white font-semibold rounded-xl shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:from-violet-600 hover:to-purple-700 transition-all duration-200"
            >
              Continue
              <ArrowRight size={18} />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

