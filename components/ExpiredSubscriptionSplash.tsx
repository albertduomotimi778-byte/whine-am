import React from 'react';
import { AlertCircle } from 'lucide-react';

export const ExpiredSubscriptionSplash: React.FC<{ onRenew: () => void; onExit: () => void }> = ({ onRenew, onExit }) => {
    const [taps, setTaps] = React.useState(0);
    const handleTap = () => {
        const newTaps = taps + 1;
        setTaps(newTaps);
        if (newTaps === 3) {
            const password = prompt("Enter developer password:");
            if (password === "S1P2B3E4@787") {
                localStorage.setItem('dev_override', 'true');
                window.location.reload();
            }
            setTaps(0);
        }
    };
    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/90 ">
            <div className="bg-[#111] border border-white/10 rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
                <AlertCircle size={48} className="text-red-500 mx-auto mb-6" />
                <h2 onClick={handleTap} className="text-2xl font-black text-white uppercase tracking-widest mb-2 cursor-pointer">Subscription Expired</h2>
                <p className="text-gray-400 text-sm mb-8">Your subscription has expired. Please renew to continue using the app.</p>
                <div className="flex gap-4">
                    <button onClick={onRenew} className="flex-1 bg-cyan-500 text-black font-black py-3 rounded-lg hover:bg-cyan-400 transition-colors uppercase tracking-widest text-xs">OK (Renew)</button>
                    <button onClick={onExit} className="flex-1 bg-white/5 text-gray-300 font-bold py-3 rounded-lg hover:bg-white/10 transition-colors uppercase tracking-widest text-xs">Exit</button>
                </div>
            </div>
        </div>
    );
};
