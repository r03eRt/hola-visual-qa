export type ConsentMode = 'accepted' | 'rejected';
export type DeviceMode = 'desktop' | 'mobile';

export interface VisualScenario {
  id: string;
  path: string;
  device: DeviceMode;
  consent: ConsentMode;
  country: string;
  adsEnabled: boolean;
}

export const scenarios: VisualScenario[] = [
  { id: 'home-desktop-accepted', path: '/', device: 'desktop', consent: 'accepted', country: 'ES', adsEnabled: true },
  { id: 'home-desktop-rejected', path: '/', device: 'desktop', consent: 'rejected', country: 'ES', adsEnabled: true },
  { id: 'home-mobile-accepted', path: '/', device: 'mobile', consent: 'accepted', country: 'ES', adsEnabled: true },
  { id: 'home-mobile-rejected', path: '/', device: 'mobile', consent: 'rejected', country: 'ES', adsEnabled: true }
];
