import React, { useRef, useState } from 'react';
import api from '../utils/api';

export default function SendMoney({ contacts, setContacts }) {
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stepLoading, setStepLoading] = useState(false);
  const [{ step }, dispatchStep] = useReducer(stepReducer, { step: 1 });
  const [feeXLM, setFeeXLM] = useState(null);
  // Issue #641: pre-submission fee estimation preview
  const [feeEstimate, setFeeEstimate] = useState(null);
  const [feeEstimateLoading, setFeeEstimateLoading] = useState(false);
  const [feeEstimateError, setFeeEstimateError] = useState(false);
  const [contractSimData, setContractSimData] = useState(null);
  const [contractSimLoading, setContractSimLoading] = useState(false);
  const [requestId] = useState(searchParams.get('request'));
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  const { shouldShowPrompt } = usePushNotifications();

  // Pre-fill form from payment request when only requestId is in the URL
  useEffect(() => {
    if (!requestId || form.recipient_address || form.amount) return;
    api
      .get(`/payment-requests/${requestId}`)
      .then((r) => {
        const { requester_wallet, amount, asset, memo } = r.data;
        setForm((f) => ({
          ...f,
          recipient_address: requester_wallet || f.recipient_address,
          amount: amount ? String(amount) : f.amount,
          asset: asset || f.asset,
          memo: memo || f.memo,
        }));
      })
      .catch(() => {});
  }, [requestId]); // eslint-disable-line react-hooks/exhaustive-deps
  const { currencies, convertFromXLM, usingApproximateRates } = useExchangeRates();
  const [pathResult, setPathResult] = useState(null);
  const [pathLoading, setPathLoading] = useState(false);
  const [memoRequired, setMemoRequired] = useState(false);
  const [memoError, setMemoError] = useState(false);
  const { memoError: hashMemoError, validateMemo, getMemoPlaceholder, isMemoValid } = useMemoValidation();
  const memoRef = useRef(null);
  const [addressError, setAddressError] = useState(false);
  // 'send' = strict send (sender specifies exact amount), 'receive' = strict receive (recipient gets exact amount)
  const [sendMode, setSendMode] = useState('send');

  // Trustline check state
  const [trustlineWarning, setTrustlineWarning] = useState(null); // null | string (asset code)

  // Path payment toggle — when enabled the user can pick a destination asset and
  // the payment is routed via Stellar DEX path payment instead of a direct transfer.
  const [usePathPayment, setUsePathPayment] = useState(false);

  // Ledger hardware wallet state
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [unsignedXDR, setUnsignedXDR] = useState(null);
  const [ledgerNetworkPassphrase, setLedgerNetworkPassphrase] = useState(null);

  const isCrossAsset = usePathPayment && form.destination_asset && form.destination_asset !== form.asset;

  /** Returns true for a valid Ed25519 public key or a federation address */
  const isValidStellarAddress = (addr) =>
    (addr.startsWith('G') && addr.length === 56) || addr.includes('*');

  // Initial/clean state used for reset and dirty-check
  const cleanForm = {
    recipient_address: searchParams.get('to') || '',
    amount: searchParams.get('amount') || '',
    asset: searchParams.get('asset') || 'XLM',
    memo: searchParams.get('memo') || '',
    destination_asset: '',
    slippage: getSavedSlippage(),
    memo_type: 'text',
    fee_priority: 'standard',
    private_note: '',
  };

  /** Clears all user-entered fields back to their URL-seeded defaults. */
  const resetForm = () => {
    setForm(cleanForm);
    setFeeXLM(null);
    setPathResult(null);
    setMemoRequired(false);
    setMemoError(false);
    setAddressError(false);
    setContractSimData(null);
    dispatchStep({ type: 'RESET' });
  };

  /** True when the user has entered data beyond the URL-seeded defaults. */
  const formIsDirty =
    form.recipient_address !== cleanForm.recipient_address ||
    form.amount !== cleanForm.amount ||
    form.memo !== cleanForm.memo ||
    (form.private_note || '') !== '';

  // Multi-wallet state
  const [wallets, setWallets] = useState([]);
  const [selectedWalletId, setSelectedWalletId] = useState(searchParams.get('wallet_id') || null);
  const [showWalletDropdown, setShowWalletDropdown] = useState(false);

  const selectedWallet = wallets.find((w) => w.id === selectedWalletId) || wallets[0] || null;

  // Available XLM balance for the selected wallet (after minimum reserve)
  const selectedWalletXlmEntry = selectedWallet?.balances?.find((b) => b.asset === 'XLM');
  const availableXlm = selectedWalletXlmEntry?.available_balance
    ? parseFloat(selectedWalletXlmEntry.available_balance)
    : null;
  const belowMinBalance =
    form.asset === 'XLM' &&
    availableXlm !== null &&
    form.amount &&
    parseFloat(form.amount) > availableXlm;

  useEffect(() => {
    api
      .get('/payments/fee-stats')
      .then((r) => setFeeStats(r.data))
      .catch(() => {});
  }, []);

  // Issue #641: debounced fee estimation preview as the user types an amount.
  useEffect(() => {
    const gross = parseFloat(form.amount);
    if (!form.amount || !Number.isFinite(gross) || gross <= 0) {
      setFeeEstimate(null);
      setFeeEstimateError(false);
      setFeeEstimateLoading(false);
      return;
    }

    let cancelled = false;
    setFeeEstimateLoading(true);
    setFeeEstimateError(false);

    const timer = setTimeout(async () => {
      try {
        const [rateRes, networkRes] = await Promise.all([
          api.get('/payments/fee-rate'),
          api.get('/payments/estimate-fee'),
        ]);
        if (cancelled) return;
        const feeBps = rateRes.data?.fee_bps;
        if (feeBps == null || Number.isNaN(Number(feeBps))) {
          throw new Error('Fee rate unavailable');
        }
        const platformFee = gross * (Number(feeBps) / 10000);
        setFeeEstimate({
          gross,
          asset: form.asset,
          feePct: Number(feeBps) / 100,
          platformFee,
          networkFeeXLM: networkRes.data?.fee_xlm ?? null,
          netAmount: gross - platformFee,
        });
      } catch {
        if (cancelled) return;
        setFeeEstimate(null);
        setFeeEstimateError(true);
      } finally {
        if (!cancelled) setFeeEstimateLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.amount, form.asset]);

  // Warn the user before closing/refreshing the tab when the form has data
  useBeforeUnload(
    React.useCallback(
      (e) => {
        if (formIsDirty) e.preventDefault();
      },
      [formIsDirty]
    )
  );

  useEffect(() => {
    api
      .get('/wallet/list')
      .then((r) => {
        setWallets(r.data.wallets || []);
        // If no wallet_id in URL, default to the user's default wallet
        if (!selectedWalletId && r.data.wallets?.length) {
          const def = r.data.wallets.find((w) => w.is_default) || r.data.wallets[0];
          setSelectedWalletId(def.id);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api
      .get('/contacts')
      .then((r) => setContacts(r.data.contacts || []))
      .catch(() => {});
  }, []);

  // Filter contacts based on search term
  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return contacts;
    const searchLower = contactSearch.toLowerCase();
    return contacts.filter(
      (contact) =>
        contact.name.toLowerCase().includes(searchLower) ||
        contact.wallet_address.toLowerCase().includes(searchLower)
    );
  }, [contacts, contactSearch]);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  // 1. Download CSV Template
  const handleDownloadTemplate = async () => {
    try {
      const response = await api.get('/api/contacts/import/template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'contacts_template.csv');
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
    } catch (err) {
      setError('Failed to download template. Please try again.');
    }
  };

  // 2. Upload CSV File
  const handleImportSubmit = async (e) => {
    e.preventDefault();
    if (!importFile) {
      setError('Please select a CSV file to import.');
      return;
    }

    const formData = new FormData();
    formData.append('file', importFile);

    setLoading(true);
    setError('');
    setImportResult(null);

    try {
      const res = await api.post('/api/contacts/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setImportResult(res.data);

      // 3. Update contact picker state dynamically without reload if new contacts were added
      if (res.data.importedContacts && res.data.importedContacts.length > 0) {
        setContacts((prevContacts) => [...prevContacts, ...res.data.importedContacts]);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to import contacts. Check file format.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      {/* Existing Send Money / Contact Picker Header */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Send Money & Contacts</h2>
        <button
          onClick={() => setShowImportModal(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
        >
          Import Contacts (CSV)
        </button>
      </div>

      {/* Import Modal Dialog */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Import Contacts via CSV</h3>
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setImportResult(null);
                  setImportFile(null);
                  setError('');
                }}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold"
              >
                &times;
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              Upload a CSV file to bulk-add frequent recipients. First, download the template to ensure correct column headers.
            </p>

            <button
              onClick={handleDownloadTemplate}
              className="mb-4 text-sm text-blue-600 hover:underline font-medium block"
            >
              ↓ Download CSV Template
            </button>

            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

            <form onSubmit={handleImportSubmit}>
              <div className="mb-4 border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <input
                  type="file"
                  accept=".csv"
                  ref={fileInputRef}
                  onChange={(e) => setImportFile(e.target.files[0])}
                  className="hidden"
                  id="csv-file-input"
                />
                <label
                  htmlFor="csv-file-input"
                  className="cursor-pointer text-sm text-blue-600 hover:underline font-medium"
                >
                  {importFile ? importFile.name : 'Click to select CSV file'}
                </label>
              </div>

              {/* Import Results & Row-Level Errors */}
              {importResult && (
                <div className="mb-4 p-4 bg-gray-50 rounded-lg text-sm max-h-40 overflow-y-auto">
                  <p className="font-semibold text-green-700 mb-1">
                    Successfully imported: {importResult.successCount || 0} contacts.
                  </p>
                  {importResult.errors && importResult.errors.length > 0 && (
                    <div className="mt-2 text-red-600">
                      <p className="font-semibold">Row-level errors:</p>
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        {importResult.errors.map((err, idx) => (
                          <li key={idx}>
                            Row {err.row}: {err.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={loading || !importFile}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? 'Uploading...' : 'Upload & Import'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowXDRInspector(true)}
                className="w-full mt-2 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <Code size={16} /> View Raw Transaction (XDR)
              </button>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => dispatchStep({ type: 'BACK' })}
                className="flex-1 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 font-semibold py-3.5 rounded-xl transition-colors"
              >
                ← Back
              </button>
              <button
                type="submit"
                className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                <Send size={18} /> Confirm
              </button>
            </div>
          </>
        )}

        {/* ── STEP 4: Authenticate ── */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-1">
              <p className="text-white font-semibold">Authorize Payment</p>
              <p className="text-gray-400 text-sm">
                Sending <span className="text-white font-medium">{form.amount} {form.asset}</span> to{' '}
                <span className="font-mono text-xs text-gray-300">
                  {form.recipient_address.slice(0, 8)}…{form.recipient_address.slice(-8)}
                </span>
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowPINVerification(true)}
              disabled={loading}
              className="w-full bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" role="status" aria-label="Loading" />
              ) : (
                '🔑 Authorize with PIN'
              )}
            </button>

            {!isCrossAsset && (
              <button
                type="button"
                onClick={handleSignWithLedger}
                disabled={loading}
                className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-600 text-white font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                🔐 Sign with Ledger
              </button>
            )}

            <button
              type="button"
              onClick={() => dispatchStep({ type: 'BACK' })}
              className="w-full text-gray-400 hover:text-white text-sm py-2 transition-colors"
            >
              ← Back to Review
            </button>
          </div>
        )}
      </form>

      <LedgerSignModal
        show={showLedgerModal}
        onClose={() => setShowLedgerModal(false)}
        xdr={unsignedXDR}
        networkPassphrase={ledgerNetworkPassphrase}
        onSigned={handleLedgerSigned}
      />

      <QRScanner
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={(address) => setForm({ ...form, recipient_address: address })}
      />

      <PINVerificationModal
        isOpen={showPINVerification}
        onClose={() => setShowPINVerification(false)}
        onSuccess={handlePINVerified}
        amount={`${form.amount} ${form.asset}`}
        recipient={form.recipient_address}
      />

      {/* XDR Inspector Modal */}
      <XDRInspectorModal
        isOpen={showXDRInspector}
        onClose={() => setShowXDRInspector(false)}
        xdr={transactionXDR}
      />

      {showPushPrompt && (
        <PushNotificationPrompt onDismiss={() => setShowPushPrompt(false)} />
      )}

      {/* Save contact prompt after successful payment */}
      {showSaveContactPrompt && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-white font-semibold text-base mb-1">Save as a contact?</h3>
            <p className="text-gray-400 text-xs font-mono mb-4 break-all">
              {showSaveContactPrompt.slice(0, 16)}…{showSaveContactPrompt.slice(-8)}
            </p>
            <input
              type="text"
              placeholder="Contact name"
              value={saveContactName}
              onChange={(e) => setSaveContactName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-primary-500 mb-4"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                type="button"
                disabled={saveContactLoading}
                onClick={async () => {
                  if (!saveContactName.trim()) return;
                  setSaveContactLoading(true);
                  try {
                    await api.post('/contacts', { name: saveContactName.trim(), wallet_address: showSaveContactPrompt });
                    toast.success('Contact saved!');
                  } catch {
                    toast.error('Could not save contact');
                  } finally {
                    setSaveContactLoading(false);
                    setShowSaveContactPrompt(null);
                    navigate('/dashboard');
                  }
                }}
                className="flex-1 bg-primary-500 hover:bg-primary-400 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
              >
                {saveContactLoading ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => { setShowSaveContactPrompt(null); navigate('/dashboard'); }}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
              >
                Skip
              </button>
            </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
