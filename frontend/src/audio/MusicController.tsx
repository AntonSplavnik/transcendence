import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useUIAudio } from './AudioProvider';

/**
 * Plays the main theme + mountain ambient only on the landing page.
 * Must be mounted inside <AudioProvider> and <HashRouter>.
 */
export default function MusicController() {
  const { pathname } = useLocation();
  const audio = useUIAudio();

  useEffect(() => {
    if (!audio.isReady) return;

    const isLanding = pathname === '/landing' || pathname === '/';

    if (isLanding) {
      audio.playMusic('music_main_theme');
      audio.playAmbient('amb_montagne');
    } else {
      audio.stopMusic();
      audio.stopAmbient();
    }
  }, [pathname, audio.isReady]);

  return null;
}
