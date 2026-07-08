import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Trophy, Youtube, Calendar, Award, Star, Search, CheckCircle2, AlertCircle, Play, Sparkles, Send, Eye, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { db, collection, doc, getDocs, updateDoc, setDoc, serverTimestamp, getDoc, query, where, onSnapshot } from '../utils/firebase';
import { ThemeType, getThemeColors } from '../utils/themeColors';
import { useLanguage } from '../utils/LanguageContext';
import { detectUserCountry, getScaledPrice } from '../utils/pppPricing';
import { getBackendApiUrl } from '../utils/api';

interface Competition {
  id: string;
  competition: string;
  price: string;
  eligibility: string;
  end_date: string;
  applicants: number;
  what_to_submit: string;
  input_fields: string;
  flyer?: string;
}

interface Tutorial {
  id: string;
  title: string;
  youtube_link: string;
  views: number;
  thumbnail?: string;
}

interface CompetitionTutorialModalProps {
  user: any;
  initialTab?: 'competition' | 'tutorial';
  theme?: ThemeType;
  onClose: () => void;
}

const HighQualityYouTubeThumbnail: React.FC<{ videoId: string | null; title: string; defaultThumb?: string }> = ({ videoId, title, defaultThumb }) => {
  const [src, setSrc] = useState<string>(() => {
    if (defaultThumb) return defaultThumb;
    if (videoId) return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    return 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=420';
  });

  const handleError = () => {
    if (!videoId) return;
    if (src.includes('maxresdefault.jpg')) {
      setSrc(`https://img.youtube.com/vi/${videoId}/sddefault.jpg`);
    } else if (src.includes('sddefault.jpg')) {
      setSrc(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`);
    } else if (src.includes('hqdefault.jpg')) {
      setSrc('https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=420');
    }
  };

  return (
    <img 
      referrerPolicy="no-referrer"
      src={src} 
      alt={title}
      onError={handleError}
      className="w-full h-full object-cover opacity-70 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500 ease-out"
    />
  );
};

export const CompetitionTutorialModal: React.FC<CompetitionTutorialModalProps> = ({
  user,
  initialTab = 'competition',
  theme = 'midnight',
  onClose,
}) => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'competition' | 'tutorial'>(initialTab);
  const [expandedCompId, setExpandedCompId] = useState<string | null>(null);
  const [activeVideoTut, setActiveVideoTut] = useState<Tutorial | null>(null);
  const [activeFlyerUrl, setActiveFlyerUrl] = useState<string | null>(null);
  const colors = getThemeColors(theme as ThemeType);
  const isLight = theme === 'light';
  const [competitions, setCompetitions] = useState<Competition[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('cached_competitions') || '[]');
    } catch (_) {
      return [];
    }
  });
  const [tutorials, setTutorials] = useState<Tutorial[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('cached_tutorials') || '[]');
    } catch (_) {
      return [];
    }
  });
  const [loading, setLoading] = useState(() => {
    try {
      const hasComps = localStorage.getItem('cached_competitions');
      const hasTuts = localStorage.getItem('cached_tutorials');
      return !(hasComps && hasTuts);
    } catch (_) {
      return true;
    }
  });
  const [formSubmitting, setFormSubmitting] = useState<string | null>(null); // competitionId
  const [submittedCompetitions, setSubmittedCompetitions] = useState<Record<string, boolean>>({});
  const [inputStates, setInputStates] = useState<Record<string, Record<string, string>>>({}); // compId -> fieldName -> value
  const [searchQuery, setSearchQuery] = useState('');
  const [payoutInfo, setPayoutInfo] = useState<string>('');
  const [showUpgradeUI, setShowUpgradeUI] = useState<string | null>(null); // holds compId when upgrading
  const [countryCode, setCountryCode] = useState<string>('NG');
  const [paystackLoading, setPaystackLoading] = useState<boolean>(false);
  const [paystackError, setPaystackError] = useState<string | null>(null);

  useEffect(() => {
    detectUserCountry().then(setCountryCode);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveVideoTut(null);
        setActiveFlyerUrl(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCompetitionPay = async (planType: 'monthly' | 'yearly') => {
    setPaystackLoading(true);
    setPaystackError(null);
    try {
      const baseNgn = planType === 'monthly' ? 1500 : 10500;
      const finalAmount = getScaledPrice(baseNgn, countryCode);
      const userEmail = user?.email?.toLowerCase()?.trim() || localStorage.getItem('pending_app_payment') || '';

      if (!userEmail) {
        throw new Error(t("Email is missing. Please sign back in first."));
      }

      // Standard storage tags for checkout
      localStorage.setItem('pending_app_payment', userEmail);
      localStorage.setItem('pending_app_plan', planType);
      localStorage.setItem('app_currency', 'NGN');

      if (!(window as any).PaystackPop) {
        throw new Error(t("Payment gateway pop is loading. Please retry."));
      }

      const handler = (window as any).PaystackPop.setup({
        key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || 'pk_live_d616663688ee4eecd3d5265784e941b3f7736a6a',
        email: userEmail,
        amount: finalAmount * 100, // Paystack requires kobo/cents
        currency: 'NGN',
        metadata: {
          email: userEmail,
          plan_type: planType,
          country: countryCode,
          language: user?.language || 'English',
        },
        callback: (response: any) => {
          console.log("Paystack Renewal success callback from Competition Modal:", response);
          window.location.href = `${window.location.origin}/payment/${encodeURIComponent(userEmail)}/${finalAmount}/${planType}/?reference=${response.reference}`;
        },
        onClose: () => {
          setPaystackLoading(false);
        }
      });

      handler.openIframe();
      setPaystackLoading(false);
      
    } catch (err: any) {
      console.error("Paystack Renewal error in CompetitionTutorialModal:", err);
      setPaystackError(err.message || t("Payment initialization aborted"));
      setPaystackLoading(false);
    }
  };

  useEffect(() => {
    const fetchPayoutAndPrefill = async () => {
      if (!user?.email) return;
      try {
        const cleanEmail = user.email.toLowerCase().trim();
        let bankName = '';
        let number = '';
        let owner = '';
        let roleId = '';

        // Query sellers sheet
        const sellerQ = query(collection(db, 'sellers'), where('email', '==', cleanEmail));
        const sellerSnap = await getDocs(sellerQ);
        if (!sellerSnap.empty) {
          const docData = sellerSnap.docs[0].data();
          bankName = docData.bankName || '';
          number = docData.accountNumber || '';
          owner = docData.bankOwnerName || '';
          roleId = docData.sellerId || sellerSnap.docs[0].id;
        }

        // Query referrals sheet if seller not found
        if (!number) {
          const refQ = query(collection(db, 'referrals'), where('email', '==', cleanEmail));
          const refSnap = await getDocs(refQ);
          if (!refSnap.empty) {
            const docData = refSnap.docs[0].data();
            bankName = docData.bankName || '';
            number = docData.accountNumber || '';
            owner = docData.bankOwnerName || '';
            roleId = docData.referralId || refSnap.docs[0].id;
          }
        }

        if (number) {
          const formatted = `${bankName} • Account: ${number} • Owner: ${owner} • ID: ${roleId}`;
          setPayoutInfo(formatted);
        }
      } catch (err) {
        console.warn("Failed to lookup existing program accounts:", err);
      }
    };

    fetchPayoutAndPrefill();
  }, [user?.email]);

  // Determine user subscription level hierarchy
  const subStatus = user?.subscription_status === 'active';
  const subType = (user?.subscription_type || '').trim().toLowerCase();

  const isUserEligible = (eligibility: string): { eligible: boolean; reason: string } => {
    const requirement = (eligibility || '').trim().toLowerCase();
    
    // Yearly always wins
    if (subStatus && subType === 'yearly') {
      return { eligible: true, reason: 'Eligible as a Yearly subscriber.' };
    }

    if (!requirement || requirement === 'free' || requirement === 'all') {
      return { eligible: true, reason: 'Public competition: Open to everyone!' };
    }

    if (!subStatus) {
      return { eligible: false, reason: `Requires ${eligibility} subscription. Please subscribe to participate!` };
    }

    // Checking specific levels
    if (requirement.includes('yearly') && subType !== 'yearly') {
      return { eligible: false, reason: 'Requires Yearly tier subscription to participate.' };
    }

    if (requirement.includes('monthly')) {
      if (subType === 'monthly' || subType === 'yearly') {
        return { eligible: true, reason: 'Eligible as a Monthly/Yearly subscriber.' };
      }
      return { eligible: false, reason: 'Requires Monthly tier subscription to participate.' };
    }

    if (requirement.includes('weekly')) {
      if (subType === 'weekly' || subType === 'monthly' || subType === 'yearly') {
        return { eligible: true, reason: 'Eligible with your active tier.' };
      }
      return { eligible: false, reason: 'Requires Weekly subscription to participate.' };
    }

    if (requirement.includes('daily')) {
      if (subType === 'daily' || subType === 'weekly' || subType === 'monthly' || subType === 'yearly') {
        return { eligible: true, reason: 'Eligible with your active subscription.' };
      }
      return { eligible: false, reason: 'Requires an active subscription to participate.' };
    }

    // Default: Must have some subscription if requirement is specified
    return { eligible: true, reason: 'Active subscription verified.' };
  };

  useEffect(() => {
    setLoading(true);

    // Active subscription real-time synchronization listeners
    const unsubscribeComps = onSnapshot(
      collection(db, 'competitions'),
      (snapshot) => {
        const compsData = snapshot.docs.map((d: any) => {
          const data = d.data();
          return {
            id: d.id,
            competition: data.competition || 'Untitled Competition',
            price: data.price || '$0',
            eligibility: data.eligibility || 'free',
            end_date: data.end_date || 'N/A',
            applicants: data.applicants !== undefined ? Number(data.applicants) : 0,
            what_to_submit: data.what_to_submit || '',
            input_fields: data.input_fields || 'dropbox link',
            flyer: data.flyer || '',
          };
        });
        setCompetitions(compsData);
        try {
          localStorage.setItem('cached_competitions', JSON.stringify(compsData));
        } catch (_) {}
        setLoading(false);
      },
      (err) => {
        console.error("Real-time competitions sync error:", err);
        setLoading(false);
      }
    );

    const unsubscribeTuts = onSnapshot(
      collection(db, 'tutorials'),
      (snapshot) => {
        const tutsData = snapshot.docs.map((d: any) => {
          const data = d.data();
          return {
            id: d.id,
            title: data.title || 'Untitled Video',
            youtube_link: data.youtube_link || '',
            views: data.views !== undefined ? Number(data.views) : 0,
            thumbnail: data.thumbnail || '',
          };
        });
        setTutorials(tutsData);
        try {
          localStorage.setItem('cached_tutorials', JSON.stringify(tutsData));
        } catch (_) {}
      },
      (err) => {
        console.error("Real-time tutorials sync error:", err);
      }
    );

    loadSubmissionsState();

    return () => {
      unsubscribeComps();
      unsubscribeTuts();
    };
  }, []);

  const loadSubmissionsState = () => {
    try {
      const email = user?.email || 'guest';
      const key = `comp_subs_${email}`;
      const saved = localStorage.getItem(key);
      if (saved) {
        setSubmittedCompetitions(JSON.parse(saved));
      }
    } catch (err) {
      console.warn("Could not load submissions state", err);
    }
  };

  const saveSubmissionState = (compId: string) => {
    try {
      const email = user?.email || 'guest';
      const key = `comp_subs_${email}`;
      const updated = { ...submittedCompetitions, [compId]: true };
      setSubmittedCompetitions(updated);
      localStorage.setItem(key, JSON.stringify(updated));
    } catch (err) {
      console.error(err);
    }
  };

  const handleInputChange = (compId: string, fieldName: string, value: string) => {
    setInputStates(prev => ({
      ...prev,
      [compId]: {
        ...(prev[compId] || {}),
        [fieldName]: value
      }
    }));
  };

  const submitApplication = async (comp: Competition) => {
    if (!user?.email) {
      alert("Please sign in to submit applications.");
      return;
    }

    const { eligible, reason } = isUserEligible(comp.eligibility);
    if (!eligible) {
      alert(`Submission blocked: ${reason}`);
      return;
    }

    const fields = comp.input_fields ? comp.input_fields.split(',').map(f => f.trim()).filter(Boolean) : ['dropbox link'];
    const subValues = { ...(inputStates[comp.id] || {}) };
    
    // Assign payout account details value. If blank, fallback to prefilled payoutInfo
    const currentPayoutDetails = subValues['Payout Account Details'] !== undefined 
      ? subValues['Payout Account Details'] 
      : payoutInfo;
    
    subValues['Payout Account Details'] = currentPayoutDetails;

    // Validate if standard fields are filled
    for (const f of fields) {
      if (!subValues[f] || !subValues[f].trim()) {
        alert(`Please supply input for "${f}" before submitting.`);
        return;
      }
    }

    setFormSubmitting(comp.id);
    try {
      const subId = `${comp.id}_${user.email.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const submissionRef = doc(db, 'competition_submissions', subId);
      
      await setDoc(submissionRef, {
        submissionId: subId,
        competitionId: comp.id,
        competitionName: comp.competition,
        userEmail: user.email,
        formData: subValues,
        submittedAt: serverTimestamp()
      });

      // Prepare mailto protocol
      const emailTarget = "egeluotechnologies@gmail.com";
      const subject = `Submission: ${comp.competition}`;
      let bodyText = `Competition: ${comp.competition}\nApplicant Email: ${user.email}\n\n--- Submission Details ---\n`;
      Object.entries(subValues).forEach(([key, val]) => {
        bodyText += `${key}: ${val}\n`;
      });
      
      const mailtoLink = `mailto:${emailTarget}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
      
      try {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = mailtoLink;
        document.body.appendChild(iframe);
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1000);
      } catch (e) {
        window.location.href = mailtoLink;
      }

      // Increment applicants on database
      const compRef = doc(db, 'competitions', comp.id);
      const docSnap = await getDoc(compRef);
      const currentApplicants = docSnap.exists() ? (Number(docSnap.data().applicants) || 0) : comp.applicants;
      const newApplicants = currentApplicants + 1;
      
      await updateDoc(compRef, { applicants: newApplicants });

      // Update Local State Optimistically
      setCompetitions(prev => prev.map(c => c.id === comp.id ? { ...c, applicants: newApplicants } : c));
      saveSubmissionState(comp.id);
      
      // Delay alert slightly to let mailto handle
      setTimeout(() => {
        alert("Good luck on your competition!");
      }, 500);
    } catch (e: any) {
      console.error(e);
      alert("Submission error: " + (e.message || String(e)));
    } finally {
      setFormSubmitting(null);
    }
  };

  const handleTutorialClick = async (tut: Tutorial) => {
    if (!tut.youtube_link) return;
    
    // Set active video tutorial to play inside our beautiful, cinematic, high-quality player modal
    setActiveVideoTut(tut);

    // Increment Views
    try {
      const tutRef = doc(db, 'tutorials', tut.id);
      const docSnap = await getDoc(tutRef);
      const currentViews = docSnap.exists() ? (Number(docSnap.data().views) || 0) : tut.views;
      const newViews = currentViews + 1;
      
      await updateDoc(tutRef, { views: newViews });
      
      // Optimistically update lists
      setTutorials(prev => prev.map(t => t.id === tut.id ? { ...t, views: newViews } : t));
    } catch (e) {
      console.warn("Failed to increment youtube tutorial views", e);
    }
  };

  const extractYouTubeId = (url: string) => {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const filteredCompetitions = competitions.filter(c => 
    c.competition.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.what_to_submit.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredTutorials = tutorials.filter(t => 
    t.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[200] bg-black/85 flex items-center justify-center p-4 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }} 
        animate={{ opacity: 1, scale: 1 }} 
        className={`border rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] shadow-[0_0_50px_rgba(0,0,0,0.8)] ${isLight ? 'bg-white border-black/10 text-gray-950 shadow-gray-200' : 'bg-[#0c0c0e] border-white/10 text-white'}`}
      >
        {/* Banner/Header */}
        <div className={`flex items-center justify-between p-5 border-b shrink-0 ${isLight ? 'bg-gray-50/85 border-black/5' : 'bg-[#111113] border-white/5'}`}>
          <div className="flex items-center gap-2.5">
            <span className={`p-1.5 rounded-lg border ${colors.bg} ${colors.text} ${colors.border}`}>
              {activeTab === 'competition' ? <Trophy size={16} /> : <Youtube size={16} />}
            </span>
            <h2 className={`text-sm font-black tracking-widest uppercase ${isLight ? 'text-gray-900' : 'text-white'}`}>
              {activeTab === 'competition' ? 'Premium Competitions' : 'Video Tutorials Lounge'}
            </h2>
          </div>
          <button 
            onClick={onClose} 
            className={`p-1.5 rounded-full transition-colors ${isLight ? 'text-gray-400 hover:text-gray-800 hover:bg-black/5' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Selection Row & Search */}
        <div className={`px-4 py-3 border-b flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 ${isLight ? 'bg-gray-50/50 border-black/5' : 'bg-[#111113] border-white/5'}`}>
          <div className={`flex p-1 border rounded-lg w-full sm:w-auto ${isLight ? 'bg-gray-100 border-black/5' : 'bg-black/40 border-white/5'}`}>
            <button 
              onClick={() => { setActiveTab('competition'); setSearchQuery(''); setExpandedCompId(null); }}
              className={`flex-1 sm:flex-initial px-4 py-1.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'competition' 
                  ? (isLight ? 'bg-white text-gray-950 shadow-sm border border-black/5' : 'bg-[#181818] text-white shadow') 
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <Trophy size={12} />
              <span>Competitions</span>
            </button>
            <button 
              onClick={() => { setActiveTab('tutorial'); setSearchQuery(''); setExpandedCompId(null); }}
              className={`flex-1 sm:flex-initial px-4 py-1.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'tutorial' 
                  ? (isLight ? 'bg-white text-gray-950 shadow-sm border border-black/5' : 'bg-[#181818] text-white shadow') 
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <Youtube size={12} />
              <span>Tutorials</span>
            </button>
          </div>

          <div className="relative w-full sm:w-56 group shrink-0">
            <Search size={12} className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:${colors.text} transition-colors`} />
            <input 
              type="text" 
              placeholder="Search..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className={`w-full rounded-md py-1.5 pl-8 pr-4 text-xs focus:ring-1 ${colors.ring} outline-none transition-all placeholder-gray-600 font-mono ${
                isLight 
                  ? 'bg-gray-50 border-black/10 text-gray-900 border focus:border-cyan-500' 
                  : 'bg-black/50 border border-white/10 text-white focus:border-cyan-500/50'
              }`}
            />
          </div>
        </div>

        {/* Content Sheet */}
        <div className={`p-4 overflow-y-auto flex-1 custom-scrollbar min-h-0 ${isLight ? 'bg-white' : 'bg-[#09090b]'}`}>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 text-gray-500 font-mono text-xs gap-2">
              <span className={`w-6 h-6 border-2 border-t-transparent rounded-full animate-spin ${colors.text}`} style={{ borderColor: 'currentColor', borderTopColor: 'transparent' }} />
              <span>Querying community sheets database...</span>
            </div>
          ) : activeTab === 'competition' ? (
            /* Competitions View */
            filteredCompetitions.length === 0 ? (
              <div className={`text-center py-16 border border-dashed rounded-xl ${isLight ? 'bg-gray-50/50 border-black/10' : 'bg-white/[0.01] border-white/5'}`}>
                <Trophy size={36} className="mx-auto text-gray-700 mb-2 animate-pulse" />
                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">No Competitions Found</p>
                <p className="text-[10px] text-gray-500 mt-2">Check back shortly for new events in the sheets!</p>
              </div>
            ) : (
              <div className="space-y-3 pb-4">
                {filteredCompetitions.map((comp) => {
                  const eligibilityCheck = isUserEligible(comp.eligibility);
                  const isSubmitted = !!submittedCompetitions[comp.id];
                  const submissionFields = comp.input_fields ? comp.input_fields.split(',').map(f => f.trim()).filter(Boolean) : ['dropbox link'];
                  const isExpanded = expandedCompId === comp.id;

                  return (
                    <div 
                      key={comp.id} 
                      className={`border rounded-xl transition-all duration-300 flex flex-col overflow-hidden ${
                        isExpanded 
                          ? (isLight ? 'bg-gray-50/70 border-black/15 shadow-md scale-[1.01]' : 'bg-[#121214] border-white/15 shadow-2xl scale-[1.01]')
                          : (isLight ? 'bg-white border-black/5 hover:border-black/10 hover:bg-gray-50/40 hover:shadow' : 'bg-[#111113]/50 border-white/5 hover:border-white/10 hover:bg-[#121214]')
                      }`}
                    >
                      {/* High-End Header / Clickable Accordion Row */}
                      <button
                        onClick={() => setExpandedCompId(isExpanded ? null : comp.id)}
                        className="w-full text-left p-3.5 flex items-center justify-between gap-3.5 transition-all"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {/* Trophy / Icon container */}
                          {comp.flyer ? (
                            <div className="w-10 h-10 rounded-lg overflow-hidden border border-white/10 bg-black/40 shrink-0 relative shadow-md transition-all duration-300">
                              <img 
                                src={comp.flyer} 
                                alt="" 
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover" 
                              />
                            </div>
                          ) : (
                            <div className={`w-8.5 h-8.5 rounded-lg flex items-center justify-center shrink-0 border transition-all duration-300 ${
                              isExpanded 
                                ? `${colors.bg} ${colors.text} ${colors.border} shadow-lg scale-105` 
                                : (isLight ? 'bg-gray-100 border-black/5 text-gray-500' : 'bg-[#18181b]/80 border-white/5 text-gray-400')
                            }`}>
                              <Trophy size={14} className={isExpanded ? 'animate-bounce text-amber-400' : ''} />
                            </div>
                          )}
                          
                          <div className="min-w-0 flex-1">
                            {/* Competition Name (Single-line, truncated) */}
                            <h3 className={`text-xs sm:text-sm font-bold tracking-wide truncate ${isLight ? 'text-gray-900' : 'text-white'}`}>
                              {comp.competition}
                            </h3>
                            
                            {/* Compact single line metadata subtext */}
                            <div className="flex items-center gap-2 mt-0.5 text-[9px] sm:text-[10px] text-gray-500 font-mono tracking-wide truncate">
                              <span className="flex items-center gap-1 shrink-0">
                                <Clock size={10} className="text-amber-500" />
                                <span>{comp.end_date}</span>
                              </span>
                              <span className="opacity-40 shrink-0">•</span>
                              <span className="shrink-0">👥 {comp.applicants} Applicants</span>
                            </div>
                          </div>
                        </div>

                        {/* Right block: Cash Prize Badge and Chevron */}
                        <div className="flex items-center gap-2.5 shrink-0">
                          <span className={`px-2 py-0.5 text-[9px] sm:text-[10px] font-black rounded-lg border uppercase tracking-wider ${colors.bg} ${colors.text} ${colors.border}`}>
                            {comp.price}
                          </span>
                          <div className={`p-1 rounded-full transition-transform duration-300 ${
                            isExpanded ? 'rotate-180 bg-white/5' : 'rotate-0'
                          } ${isLight ? 'text-gray-400 hover:text-gray-900' : 'text-gray-500 hover:text-white'}`}>
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </div>
                        </div>
                      </button>

                      {/* Expanded Section with Smooth Framer Motion Collapse/Expand */}
                      <AnimatePresence initial={false}>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: 'easeInOut' }}
                            className={`border-t overflow-hidden ${isLight ? 'border-black/5 bg-gray-55/30' : 'border-white/5 bg-black/10'}`}
                          >
                            <div className="p-4 space-y-4">
                              {/* Competition flyer banner card */}
                              {comp.flyer && (
                                <div 
                                  className="group relative rounded-xl overflow-hidden border border-white/10 bg-black/45 shadow-lg max-h-[220px] aspect-[21/9] sm:aspect-[16/6] w-full flex items-center justify-center cursor-pointer transition-all hover:border-[#00e5ff]/30 hover:shadow-[0_0_20px_rgba(0,229,255,0.15)]" 
                                  onClick={() => setActiveFlyerUrl(comp.flyer || null)}
                                >
                                  <img 
                                    referrerPolicy="no-referrer"
                                    src={comp.flyer} 
                                    alt={`${comp.competition} Flyer`} 
                                    className="w-full h-full object-cover group-hover:scale-105 transition-all duration-700 ease-out opacity-85 group-hover:opacity-100"
                                  />
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-4">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] font-black tracking-wider text-[#00e5ff] uppercase bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/25">
                                        EVENT FLYER
                                      </span>
                                      <span className="text-[9px] text-white/70 font-bold bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-md opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 transition-all duration-300">
                                        Click to Expand 🔍
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* description and what to submit */}
                              <div className={`p-3.5 rounded-xl border leading-relaxed text-xs space-y-2 ${isLight ? 'bg-white border-black/5 text-gray-700' : 'bg-white/2 border-white/5 text-gray-350'}`}>
                                <div className="flex items-center gap-1.5 font-bold uppercase tracking-widest text-[9px] text-gray-500 font-mono mb-1">
                                  <Award size={12} className={colors.text} />
                                  <span>{t('Brief Details & Criteria')}</span>
                                </div>
                                <p className="font-sans leading-relaxed text-[11px] font-medium">{comp.what_to_submit}</p>
                              </div>

                              {/* Submission Content container */}
                              <div className={`border rounded-xl p-4 space-y-3.5 ${isLight ? 'bg-white border-black/5 shadow-inner' : 'bg-[#0f0f11] border-white/5'}`}>
                                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                                  <span className={`text-[10px] uppercase tracking-widest font-mono font-black ${colors.text}`}>
                                    {t('Submit Entry Materials')}
                                  </span>
                                  <span className="text-[9px] text-gray-500 font-sans">{eligibilityCheck.reason}</span>
                                </div>

                                {isSubmitted ? (
                                  <div className={`flex items-center justify-center gap-2 py-5 border border-dashed rounded-xl text-xs font-black uppercase tracking-wider ${isLight ? 'bg-emerald-50 text-emerald-600 border-emerald-300' : `${colors.bg} ${colors.text} border-emerald-500/30 animate-pulse`}`}>
                                    <CheckCircle2 size={16} />
                                    <span>{t('Contest Entered! Best of luck!')}</span>
                                  </div>
                                ) : !eligibilityCheck.eligible ? (
                                  <div className="space-y-4 w-full">
                                    <div className="flex items-start gap-2.5 p-3.5 border border-dashed border-red-500/20 bg-red-500/5 text-red-500 rounded-xl text-xs">
                                      <AlertCircle size={15} className="shrink-0 text-red-500 mt-0.5" />
                                      <div>
                                        <span className="font-black uppercase tracking-wider block mb-1">{t('Access Restricted')}</span>
                                        <p className="opacity-90 leading-relaxed text-[11px]">{eligibilityCheck.reason}</p>
                                      </div>
                                    </div>

                                    {showUpgradeUI !== comp.id ? (
                                      <button
                                        onClick={() => setShowUpgradeUI(comp.id)}
                                        className="w-full py-2.5 bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-400 hover:to-amber-500 text-black font-black text-xs uppercase tracking-widest rounded-xl transition-all active:scale-98 flex items-center justify-center gap-1.5 shadow-md cursor-pointer border-0"
                                      >
                                        <Star size={13} className="fill-current text-black animate-pulse" />
                                        <span>{t('Get a Monthly/Yearly Subscription')}</span>
                                      </button>
                                    ) : (
                                      <div className="space-y-4 pt-3.5 border-t border-white/5 animate-in fade-in duration-300">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest font-black">{t('Choose Creator Subscription')}</span>
                                          <button 
                                            onClick={() => setShowUpgradeUI(null)}
                                            className="text-[10px] text-red-500 hover:text-red-400 bg-transparent border-0 cursor-pointer font-bold font-mono"
                                          >
                                            {t('Cancel')}
                                          </button>
                                        </div>

                                        {paystackError && (
                                          <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-md flex items-center gap-2 text-[11px] text-red-500">
                                            <AlertCircle size={14} className="shrink-0 text-red-500" />
                                            <span>{paystackError}</span>
                                          </div>
                                        )}

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                          {/* Monthly Plan */}
                                          <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 flex flex-col justify-between hover:border-cyan-500/30 transition-all group relative overflow-hidden">
                                            <div>
                                              <div className="flex items-center justify-between mb-2">
                                                <span className="text-[9px] text-cyan-400 uppercase tracking-widest font-black">{t('Flexible')}</span>
                                              </div>
                                              <h4 className="text-sm font-black text-white mb-0.5">Monthly Plan</h4>
                                              <div className="mb-3">
                                                <span className="text-lg font-black text-white">₦{getScaledPrice(1500, countryCode).toLocaleString()}</span>
                                                <span className="text-[10px] text-gray-500 ml-1">/ {t('month')}</span>
                                              </div>
                                            </div>
                                            <button
                                              disabled={paystackLoading}
                                              onClick={() => handleCompetitionPay('monthly')}
                                              className="w-full py-2 bg-white/5 group-hover:bg-cyan-500 group-hover:text-black border border-white/10 group-hover:border-cyan-400 font-bold text-[10px] uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1"
                                            >
                                              <span>{paystackLoading ? t('Starting...') : t('Unlock Monthly')}</span>
                                            </button>
                                          </div>

                                          {/* Yearly Plan */}
                                          <div className="bg-gradient-to-b from-yellow-500/5 to-transparent border border-yellow-500/20 rounded-xl p-4 flex flex-col justify-between hover:border-yellow-400/40 transition-all group relative overflow-hidden">
                                            <div className="absolute top-0 right-0 bg-yellow-500 text-black text-[7px] font-black tracking-widest uppercase py-0.5 px-2 rounded-bl-lg">
                                              {t('BEST VALUE')}
                                            </div>
                                            <div>
                                              <div className="flex items-center justify-between mb-2">
                                                <span className="text-[9px] text-yellow-500 uppercase tracking-widest font-black">{t('Save Over 40%')}</span>
                                              </div>
                                              <h4 className="text-sm font-black text-white mb-0.5">Yearly Plan</h4>
                                              <div className="mb-3">
                                                <span className="text-lg font-black text-white">₦{getScaledPrice(10500, countryCode).toLocaleString()}</span>
                                                <span className="text-[10px] text-gray-500 ml-1">/ {t('year')}</span>
                                              </div>
                                            </div>
                                            <button
                                              disabled={paystackLoading}
                                              onClick={() => handleCompetitionPay('yearly')}
                                              className="w-full py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-[10px] uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1 border-0"
                                            >
                                              <span>{paystackLoading ? t('Starting...') : t('Unlock Yearly')}</span>
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="space-y-4">
                                    {submissionFields.map((field) => (
                                      <div key={field} className="flex flex-col gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                                        <label className={`text-[10px] font-mono uppercase tracking-wider font-bold ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                                          {field}
                                        </label>
                                        <input 
                                          type="text"
                                          placeholder={`Paste your ${field} links/content...`}
                                          value={inputStates[comp.id]?.[field] || ''}
                                          onChange={(e) => handleInputChange(comp.id, field, e.target.value)}
                                          className={`w-full border rounded-xl px-3 py-2.5 text-xs placeholder-gray-600 outline-none transition-all font-mono font-semibold focus:ring-1 ${colors.ring} ${isLight ? 'bg-white border-black/15 text-gray-900 focus:border-cyan-500' : 'bg-black/40 border-white/10 text-white focus:border-cyan-500/50'}`}
                                        />
                                      </div>
                                    ))}

                                    <div className="flex flex-col gap-1.5 pt-3.5 border-t border-white/5">
                                      <label className={`text-[10px] font-mono uppercase tracking-wider font-black flex items-center gap-1.5 ${colors.text}`}>
                                        <span className="shrink-0">🏦</span>
                                        <span>Payout Account Details</span>
                                        <span className="text-[8px] text-gray-500 font-normal italic lowercase">(prefilled from program database, correct if needed)</span>
                                      </label>
                                      <input 
                                        type="text"
                                        placeholder="Enter account payout details here..."
                                        value={inputStates[comp.id]?.['Payout Account Details'] !== undefined ? inputStates[comp.id]?.['Payout Account Details'] : payoutInfo}
                                        onChange={(e) => handleInputChange(comp.id, 'Payout Account Details', e.target.value)}
                                        className={`w-full border rounded-xl px-3 py-2.5 text-xs placeholder-gray-650 outline-none transition-all font-mono font-medium focus:ring-1 ${colors.ring} ${isLight ? 'bg-white border-black/15 text-gray-900 focus:border-cyan-500' : 'bg-black/40 border-white/10 text-white focus:border-cyan-500/50'}`}
                                      />
                                    </div>

                                    <button 
                                      disabled={formSubmitting === comp.id}
                                      onClick={() => submitApplication(comp)}
                                      className={`mt-2 w-full py-3 ${colors.buttonActiveBg} hover:${colors.buttonActiveHover} ${colors.buttonActiveText} font-black text-xs uppercase tracking-widest rounded-xl transition-all active:scale-98 flex items-center justify-center gap-2 shadow-lg cursor-pointer disabled:opacity-50`}
                                    >
                                      <Send size={13} />
                                      <span>{formSubmitting === comp.id ? 'Uploading...' : 'Submit Entry'}</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            /* Tutorials View */
            filteredTutorials.length === 0 ? (
              <div className={`text-center py-16 border border-dashed rounded-xl ${isLight ? 'bg-gray-50/50 border-black/10' : 'bg-white/[0.01] border-white/5'}`}>
                <Youtube size={36} className="mx-auto text-gray-700 mb-2 animate-pulse" />
                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">No Tutorials Found</p>
                <p className="text-[10px] text-gray-500 mt-2">Check back shortly for new video releases!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4">
                {filteredTutorials.map((tut) => {
                  const videoId = extractYouTubeId(tut.youtube_link);

                  return (
                    <div 
                      key={tut.id} 
                      onClick={() => handleTutorialClick(tut)}
                      className={`overflow-hidden cursor-pointer transition-all hover:shadow-xl group flex flex-col h-full rounded-xl border ${
                        isLight 
                          ? 'bg-gray-50/70 border-black/5 hover:border-black/15 hover:bg-gray-50' 
                          : 'bg-[#111113] border-white/5 hover:border-cyan-500/30 hover:bg-[#0a0a0a]'
                      }`}
                    >
                      {/* Video Thumbnail Area with Stack/Overlay */}
                      <div className="aspect-video w-full relative bg-black flex items-center justify-center overflow-hidden">
                        <HighQualityYouTubeThumbnail videoId={videoId} title={tut.title} defaultThumb={tut.thumbnail} />
                        
                        {/* Play Overlay */}
                        <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 flex items-center justify-center transition-all">
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-2xl scale-95 group-hover:scale-105 transition-all duration-300 ${colors.buttonActiveBg} ${colors.buttonActiveText} hover:${colors.buttonActiveHover}`}>
                            <Play size={20} className="fill-current text-current ml-1" />
                          </div>
                        </div>
                        {/* YouTube Badge */}
                        <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-red-600 border border-red-500 text-white rounded font-bold text-[8px] uppercase tracking-wider">
                          YouTube
                        </div>
                      </div>

                      {/* Video Info Panel */}
                      <div className={`p-3 flex-1 flex flex-col justify-between gap-2 ${isLight ? 'bg-white' : 'bg-[#111113]'}`}>
                        <h4 className={`text-xs font-bold line-clamp-2 transition-colors h-8 leading-normal group-hover:${colors.text} ${isLight ? 'text-gray-900' : 'text-gray-200'}`}>
                          {tut.title}
                        </h4>
                        <div className="flex items-center justify-between text-[10px] text-gray-500 border-t border-white/5 pt-2 font-mono">
                          <span className="flex items-center gap-1 font-bold text-gray-400">
                            <Eye size={11} className={colors.text} /> {tut.views} views
                          </span>
                          <span className="text-[9px] text-[#9d9da4] hover:underline flex items-center gap-1">Launch Video</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>

        {/* Info Footer */}
        <div className={`p-4 border-t text-[9px] text-gray-500 font-mono text-center shrink-0 flex items-center justify-center gap-1.5 ${isLight ? 'bg-gray-50/80 border-black/5' : 'bg-[#111113] border-white/5'}`}>
          <Sparkles size={10} className={`${colors.text} animate-pulse`} />
          <span>@Animato Studio</span>
        </div>
      </motion.div>

      {/* Cinematic Inline Video Player Overlay with High Quality Stream */}
      <AnimatePresence>
        {activeVideoTut && (() => {
          const videoId = extractYouTubeId(activeVideoTut.youtube_link);
          return (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6"
              onClick={() => setActiveVideoTut(null)}
            >
              {/* Close controls at top-right */}
              <div className="absolute top-4 right-4 flex items-center gap-2.5 z-10">
                {activeVideoTut.youtube_link && (
                  <a 
                    href={activeVideoTut.youtube_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-1.5 bg-red-600/10 hover:bg-red-600/20 text-red-500 border border-red-500/30 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Youtube size={14} />
                    <span>Watch on YouTube</span>
                  </a>
                )}
                <button 
                  onClick={() => setActiveVideoTut(null)}
                  className="p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all border border-white/10 cursor-pointer"
                  title="Close Player (Esc)"
                >
                  <X size={18} />
                </button>
              </div>

              <motion.div 
                initial={{ scale: 0.95, y: 15 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 15 }}
                transition={{ type: "spring", damping: 25, stiffness: 350 }}
                className="w-full max-w-4xl flex flex-col gap-4"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Lesson Header Title */}
                <div className="text-left">
                  <span className="text-[10px] font-black tracking-widest text-[#00e5ff] uppercase bg-cyan-500/10 px-2.5 py-1 rounded-md border border-cyan-500/20">
                    STUDIO HQ TUTORIAL
                  </span>
                  <h3 className="text-base sm:text-xl font-black text-white mt-2 tracking-wide leading-tight line-clamp-1">
                    {activeVideoTut.title}
                  </h3>
                </div>

                {/* Video Stage Frame */}
                <div className="aspect-video w-full rounded-2xl bg-black overflow-hidden border border-white/10 shadow-[0_0_50px_rgba(0,229,255,0.15)] relative">
                  {videoId ? (
                    <iframe 
                      src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&vq=hd1080&hd=1&modestbranding=1&showinfo=0`}
                      title={activeVideoTut.title}
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      className="w-full h-full"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 gap-2">
                      <AlertCircle size={32} />
                      <p className="text-xs">No video ID extractable. Please launch on YouTube directly.</p>
                    </div>
                  )}
                </div>

                {/* Player Status info */}
                <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] text-gray-400 font-mono border-t border-white/5 pt-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>Streaming in 1080p Full HD Quality (HQ)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span>👁️ {activeVideoTut.views} views</span>
                    <span className="text-[#00e5ff] font-bold">Auto-Quality Active</span>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Immersive Image Lightbox for High Quality Flyer Viewing */}
      <AnimatePresence>
        {activeFlyerUrl && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6 cursor-zoom-out"
            onClick={() => setActiveFlyerUrl(null)}
          >
            {/* Close controls at top-right */}
            <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
              <button 
                onClick={() => setActiveFlyerUrl(null)}
                className="p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all border border-white/10 cursor-pointer"
                title="Close Flyer (Esc)"
              >
                <X size={18} />
              </button>
            </div>

            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              className="w-full max-w-3xl max-h-[85vh] flex flex-col items-center relative"
              onClick={(e) => e.stopPropagation()}
            >
              <img 
                referrerPolicy="no-referrer"
                src={activeFlyerUrl} 
                alt="Expanded Event Flyer" 
                className="max-w-full max-h-[80vh] rounded-2xl object-contain border border-white/15 shadow-[0_0_50px_rgba(0,229,255,0.2)] animate-in zoom-in-95 duration-200"
              />
              <span className="text-[10px] text-gray-400 font-mono mt-3 uppercase tracking-wider bg-black/55 px-3 py-1 rounded-full border border-white/5">
                Press Esc or click background to close
              </span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
