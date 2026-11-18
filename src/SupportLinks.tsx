import { useEffect, useState } from 'react';

type PublicInfo = { support_email: string; privacy_url: string; terms_url: string };

export default function SupportLinks() {
  const [info, setInfo] = useState<PublicInfo>();
  useEffect(() => {
    let active = true;
    fetch('/api/public-info').then(async response => {
      if (!response.ok) return;
      const result = await response.json();
      if (active) setInfo(result);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  if (!info || (!info.support_email && !info.privacy_url && !info.terms_url)) return null;
  const link = 'underline focus-visible:outline-2 focus-visible:outline-amber-400';
  return <footer className="mx-auto flex max-w-4xl flex-wrap justify-center gap-5 px-4 py-6 text-sm text-slate-300">
    {info.support_email && <a className={link} href={'mailto:' + encodeURIComponent(info.support_email)}>Contact support</a>}
    {info.privacy_url && <a className={link} href={info.privacy_url}>Privacy</a>}
    {info.terms_url && <a className={link} href={info.terms_url}>Terms</a>}
  </footer>;
}
