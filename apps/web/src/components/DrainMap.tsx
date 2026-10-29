import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import { cn } from '../lib/format';
import type { AlertSeverity, DrainListItem } from '../lib/types';

const defaultCenter: [number, number] = [-1.2921, 36.8219];

function markerIcon(kind: 'active' | 'warning' | 'ok' | 'inactive') {
  return L.divIcon({
    className: '',
    html: `<div class="dg-marker dg-marker--${kind}"><span></span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });
}

function alertKind(drain: DrainListItem): 'active' | 'warning' | 'ok' | 'inactive' {
  if (drain.status === 'INACTIVE') return 'inactive';
  const severities = drain.alerts.map((alert) => alert.severity as AlertSeverity);
  if (severities.includes('CRITICAL')) return 'active';
  if (severities.includes('WARNING') || severities.includes('INFO')) return 'warning';
  return 'ok';
}

function FitBounds({ drains }: { drains: DrainListItem[] }) {
  const map = useMap();

  useEffect(() => {
    const timer = window.setTimeout(() => map.invalidateSize(), 120);
    if (drains.length === 1) {
      map.setView([drains[0].latitude, drains[0].longitude], 15);
    } else if (drains.length > 1) {
      const bounds = L.latLngBounds(drains.map((drain) => [drain.latitude, drain.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [38, 38], maxZoom: 15 });
    }
    return () => window.clearTimeout(timer);
  }, [drains, map]);

  return null;
}

export function DrainMap({
  drains,
  className,
  singleDrain = false,
}: {
  drains: DrainListItem[];
  className?: string;
  singleDrain?: boolean;
}) {
  const center: [number, number] = drains.length === 1 ? [drains[0].latitude, drains[0].longitude] : defaultCenter;

  return (
    <div className={cn('relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100', className)}>
      <MapContainer
        center={center}
        zoom={singleDrain ? 15 : 12}
        scrollWheelZoom={false}
        className="h-full w-full"
        attributionControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {drains.map((drain) => {
          const openAlerts = drain.alerts.filter((alert) => alert.status !== 'RESOLVED');
          return (
            <Marker
              key={drain.id}
              position={[drain.latitude, drain.longitude]}
              icon={markerIcon(alertKind(drain))}
              title={drain.name}
            >
              <Popup>
                <div className="min-w-[190px]">
                  <p className="text-[13px] font-semibold text-slate-900">{drain.name}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {drain.zone}
                    {drain.address ? ` · ${drain.address}` : ''}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className={cn('text-[11px] font-medium', openAlerts.length ? 'text-red-600' : 'text-emerald-700')}>
                      {openAlerts.length ? `${openAlerts.length} open alert${openAlerts.length === 1 ? '' : 's'}` : 'No open alerts'}
                    </span>
                    <Link to={`/drains/${drain.id}`} className="text-[11px] font-semibold text-brand-700 hover:underline">
                      Open drain
                    </Link>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
        <FitBounds drains={drains} />
      </MapContainer>
    </div>
  );
}
