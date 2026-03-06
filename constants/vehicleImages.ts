interface VehicleImageEntry {
  keywords: string[];
  imageUrl: string;
  label: string;
}

const VEHICLE_IMAGES: VehicleImageEntry[] = [
  {
    keywords: ['toyota', 'corolla'],
    imageUrl: 'https://images.unsplash.com/photo-1623869675781-80aa31012c5a?w=400&h=250&fit=crop',
    label: 'Toyota Corolla',
  },
  {
    keywords: ['toyota', 'camry'],
    imageUrl: 'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=400&h=250&fit=crop',
    label: 'Toyota Camry',
  },
  {
    keywords: ['toyota', 'yaris'],
    imageUrl: 'https://images.unsplash.com/photo-1559416523-140ddc3d238c?w=400&h=250&fit=crop',
    label: 'Toyota Yaris',
  },
  {
    keywords: ['toyota', 'c-hr', 'chr'],
    imageUrl: 'https://images.unsplash.com/photo-1616422285623-13ff0162193c?w=400&h=250&fit=crop',
    label: 'Toyota C-HR',
  },
  {
    keywords: ['honda', 'civic'],
    imageUrl: 'https://images.unsplash.com/photo-1679239872412-32d0a4e23b24?w=400&h=250&fit=crop',
    label: 'Honda Civic',
  },
  {
    keywords: ['honda', 'accord'],
    imageUrl: 'https://images.unsplash.com/photo-1606152421802-db97b9c7b11b?w=400&h=250&fit=crop',
    label: 'Honda Accord',
  },
  {
    keywords: ['bmw', '3', 'series', '320', '318', '330'],
    imageUrl: 'https://images.unsplash.com/photo-1555215695-3004980ad54e?w=400&h=250&fit=crop',
    label: 'BMW 3 Series',
  },
  {
    keywords: ['bmw', '5', '520', '525', '530'],
    imageUrl: 'https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?w=400&h=250&fit=crop',
    label: 'BMW 5 Series',
  },
  {
    keywords: ['bmw'],
    imageUrl: 'https://images.unsplash.com/photo-1555215695-3004980ad54e?w=400&h=250&fit=crop',
    label: 'BMW',
  },
  {
    keywords: ['mercedes', 'benz', 'c180', 'c200', 'c class', 'c-class'],
    imageUrl: 'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=400&h=250&fit=crop',
    label: 'Mercedes-Benz C',
  },
  {
    keywords: ['mercedes', 'benz', 'e200', 'e250', 'e class', 'e-class'],
    imageUrl: 'https://images.unsplash.com/photo-1553440569-bcc63803a83d?w=400&h=250&fit=crop',
    label: 'Mercedes-Benz E',
  },
  {
    keywords: ['mercedes', 'benz'],
    imageUrl: 'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=400&h=250&fit=crop',
    label: 'Mercedes-Benz',
  },
  {
    keywords: ['audi', 'a3'],
    imageUrl: 'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=400&h=250&fit=crop',
    label: 'Audi A3',
  },
  {
    keywords: ['audi', 'a4'],
    imageUrl: 'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=400&h=250&fit=crop',
    label: 'Audi A4',
  },
  {
    keywords: ['audi'],
    imageUrl: 'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=400&h=250&fit=crop',
    label: 'Audi',
  },
  {
    keywords: ['volkswagen', 'vw', 'passat'],
    imageUrl: 'https://images.unsplash.com/photo-1632038229037-9d8484fb8cbd?w=400&h=250&fit=crop',
    label: 'Volkswagen Passat',
  },
  {
    keywords: ['volkswagen', 'vw', 'golf'],
    imageUrl: 'https://images.unsplash.com/photo-1619405399517-d7fce0f13302?w=400&h=250&fit=crop',
    label: 'Volkswagen Golf',
  },
  {
    keywords: ['volkswagen', 'vw', 'polo'],
    imageUrl: 'https://images.unsplash.com/photo-1619405399517-d7fce0f13302?w=400&h=250&fit=crop',
    label: 'Volkswagen Polo',
  },
  {
    keywords: ['volkswagen', 'vw'],
    imageUrl: 'https://images.unsplash.com/photo-1632038229037-9d8484fb8cbd?w=400&h=250&fit=crop',
    label: 'Volkswagen',
  },
  {
    keywords: ['fiat', 'egea'],
    imageUrl: 'https://images.unsplash.com/photo-1594950195003-1a34751f9cf6?w=400&h=250&fit=crop',
    label: 'Fiat Egea',
  },
  {
    keywords: ['fiat', 'linea'],
    imageUrl: 'https://images.unsplash.com/photo-1594950195003-1a34751f9cf6?w=400&h=250&fit=crop',
    label: 'Fiat Linea',
  },
  {
    keywords: ['fiat', '500'],
    imageUrl: 'https://images.unsplash.com/photo-1595787572697-97c11f342b82?w=400&h=250&fit=crop',
    label: 'Fiat 500',
  },
  {
    keywords: ['fiat'],
    imageUrl: 'https://images.unsplash.com/photo-1594950195003-1a34751f9cf6?w=400&h=250&fit=crop',
    label: 'Fiat',
  },
  {
    keywords: ['renault', 'clio'],
    imageUrl: 'https://images.unsplash.com/photo-1609521263047-f8f205293f24?w=400&h=250&fit=crop',
    label: 'Renault Clio',
  },
  {
    keywords: ['renault', 'megane'],
    imageUrl: 'https://images.unsplash.com/photo-1609521263047-f8f205293f24?w=400&h=250&fit=crop',
    label: 'Renault Megane',
  },
  {
    keywords: ['renault', 'fluence'],
    imageUrl: 'https://images.unsplash.com/photo-1609521263047-f8f205293f24?w=400&h=250&fit=crop',
    label: 'Renault Fluence',
  },
  {
    keywords: ['renault'],
    imageUrl: 'https://images.unsplash.com/photo-1609521263047-f8f205293f24?w=400&h=250&fit=crop',
    label: 'Renault',
  },
  {
    keywords: ['hyundai', 'i20'],
    imageUrl: 'https://images.unsplash.com/photo-1629897048514-3dd7414fe72a?w=400&h=250&fit=crop',
    label: 'Hyundai i20',
  },
  {
    keywords: ['hyundai', 'tucson'],
    imageUrl: 'https://images.unsplash.com/photo-1629897048514-3dd7414fe72a?w=400&h=250&fit=crop',
    label: 'Hyundai Tucson',
  },
  {
    keywords: ['hyundai', 'accent', 'elantra'],
    imageUrl: 'https://images.unsplash.com/photo-1629897048514-3dd7414fe72a?w=400&h=250&fit=crop',
    label: 'Hyundai',
  },
  {
    keywords: ['hyundai'],
    imageUrl: 'https://images.unsplash.com/photo-1629897048514-3dd7414fe72a?w=400&h=250&fit=crop',
    label: 'Hyundai',
  },
  {
    keywords: ['kia', 'ceed', 'cerato'],
    imageUrl: 'https://images.unsplash.com/photo-1670974812578-4cbe66afb4c4?w=400&h=250&fit=crop',
    label: 'Kia',
  },
  {
    keywords: ['kia'],
    imageUrl: 'https://images.unsplash.com/photo-1670974812578-4cbe66afb4c4?w=400&h=250&fit=crop',
    label: 'Kia',
  },
  {
    keywords: ['ford', 'focus'],
    imageUrl: 'https://images.unsplash.com/photo-1551830820-330a71b99659?w=400&h=250&fit=crop',
    label: 'Ford Focus',
  },
  {
    keywords: ['ford', 'fiesta'],
    imageUrl: 'https://images.unsplash.com/photo-1551830820-330a71b99659?w=400&h=250&fit=crop',
    label: 'Ford Fiesta',
  },
  {
    keywords: ['ford'],
    imageUrl: 'https://images.unsplash.com/photo-1551830820-330a71b99659?w=400&h=250&fit=crop',
    label: 'Ford',
  },
  {
    keywords: ['opel', 'astra'],
    imageUrl: 'https://images.unsplash.com/photo-1610768764270-790fbec18178?w=400&h=250&fit=crop',
    label: 'Opel Astra',
  },
  {
    keywords: ['opel', 'corsa'],
    imageUrl: 'https://images.unsplash.com/photo-1610768764270-790fbec18178?w=400&h=250&fit=crop',
    label: 'Opel Corsa',
  },
  {
    keywords: ['opel'],
    imageUrl: 'https://images.unsplash.com/photo-1610768764270-790fbec18178?w=400&h=250&fit=crop',
    label: 'Opel',
  },
  {
    keywords: ['peugeot', '208', '301', '308', '508'],
    imageUrl: 'https://images.unsplash.com/photo-1617469767053-d3b523a0b982?w=400&h=250&fit=crop',
    label: 'Peugeot',
  },
  {
    keywords: ['peugeot'],
    imageUrl: 'https://images.unsplash.com/photo-1617469767053-d3b523a0b982?w=400&h=250&fit=crop',
    label: 'Peugeot',
  },
  {
    keywords: ['citroen', 'c3', 'c4', 'c5'],
    imageUrl: 'https://images.unsplash.com/photo-1600712242805-5f78671b24da?w=400&h=250&fit=crop',
    label: 'Citroen',
  },
  {
    keywords: ['citroen'],
    imageUrl: 'https://images.unsplash.com/photo-1600712242805-5f78671b24da?w=400&h=250&fit=crop',
    label: 'Citroen',
  },
  {
    keywords: ['volvo', 's60', 's90', 'xc60', 'xc90'],
    imageUrl: 'https://images.unsplash.com/photo-1614200179396-2bdb77ebf81b?w=400&h=250&fit=crop',
    label: 'Volvo',
  },
  {
    keywords: ['volvo'],
    imageUrl: 'https://images.unsplash.com/photo-1614200179396-2bdb77ebf81b?w=400&h=250&fit=crop',
    label: 'Volvo',
  },
  {
    keywords: ['nissan', 'micra', 'qashqai', 'juke'],
    imageUrl: 'https://images.unsplash.com/photo-1609521263047-f8f205293f24?w=400&h=250&fit=crop',
    label: 'Nissan',
  },
  {
    keywords: ['nissan'],
    imageUrl: 'https://images.unsplash.com/photo-1609521263047-f8f205293f24?w=400&h=250&fit=crop',
    label: 'Nissan',
  },
  {
    keywords: ['skoda', 'octavia', 'superb', 'fabia'],
    imageUrl: 'https://images.unsplash.com/photo-1632038229037-9d8484fb8cbd?w=400&h=250&fit=crop',
    label: 'Skoda',
  },
  {
    keywords: ['skoda'],
    imageUrl: 'https://images.unsplash.com/photo-1632038229037-9d8484fb8cbd?w=400&h=250&fit=crop',
    label: 'Skoda',
  },
  {
    keywords: ['seat', 'leon', 'ibiza'],
    imageUrl: 'https://images.unsplash.com/photo-1619405399517-d7fce0f13302?w=400&h=250&fit=crop',
    label: 'Seat',
  },
  {
    keywords: ['seat'],
    imageUrl: 'https://images.unsplash.com/photo-1619405399517-d7fce0f13302?w=400&h=250&fit=crop',
    label: 'Seat',
  },
  {
    keywords: ['tesla', 'model'],
    imageUrl: 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=400&h=250&fit=crop',
    label: 'Tesla',
  },
  {
    keywords: ['tesla'],
    imageUrl: 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=400&h=250&fit=crop',
    label: 'Tesla',
  },
  {
    keywords: ['vespa', 'sprint', 'primavera'],
    imageUrl: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=400&h=250&fit=crop',
    label: 'Vespa',
  },
  {
    keywords: ['scooter', 'e-scooter', 'marti', 'martı'],
    imageUrl: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=400&h=250&fit=crop',
    label: 'Scooter',
  },
  {
    keywords: ['honda', 'pcx', 'forza', 'sh'],
    imageUrl: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=400&h=250&fit=crop',
    label: 'Honda Motorsiklet',
  },
  {
    keywords: ['yamaha', 'nmax', 'xmax', 'mt'],
    imageUrl: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=400&h=250&fit=crop',
    label: 'Yamaha',
  },
];

const DEFAULT_VEHICLE_IMAGE = 'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=400&h=250&fit=crop';

export function getVehicleImageUrl(vehicleModel: string): string {
  if (!vehicleModel || vehicleModel.trim() === '') {
    console.log('[VehicleImage] No model provided, using default');
    return DEFAULT_VEHICLE_IMAGE;
  }

  const modelLower = vehicleModel.toLowerCase().trim();
  const modelWords = modelLower.split(/[\s\-\/]+/);

  let bestMatch: VehicleImageEntry | null = null;
  let bestScore = 0;

  for (const entry of VEHICLE_IMAGES) {
    let score = 0;
    for (const keyword of entry.keywords) {
      const kwLower = keyword.toLowerCase();
      if (modelLower.includes(kwLower)) {
        score += kwLower.length;
      } else {
        for (const word of modelWords) {
          if (word === kwLower || word.startsWith(kwLower) || kwLower.startsWith(word)) {
            score += Math.min(word.length, kwLower.length);
          }
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  if (bestMatch && bestScore >= 3) {
    console.log('[VehicleImage] Matched:', vehicleModel, '->', bestMatch.label, '(score:', bestScore, ')');
    return bestMatch.imageUrl;
  }

  console.log('[VehicleImage] No match for:', vehicleModel, '- using default');
  return DEFAULT_VEHICLE_IMAGE;
}

export function getVehicleBrandFromModel(vehicleModel: string): string {
  if (!vehicleModel) return '';
  const lower = vehicleModel.toLowerCase();
  const brands = [
    'Toyota', 'Honda', 'BMW', 'Mercedes', 'Audi', 'Volkswagen',
    'Fiat', 'Renault', 'Hyundai', 'Kia', 'Ford', 'Opel',
    'Peugeot', 'Citroen', 'Volvo', 'Nissan', 'Skoda', 'Seat',
    'Tesla', 'Vespa', 'Yamaha',
  ];
  for (const brand of brands) {
    if (lower.includes(brand.toLowerCase())) {
      return brand;
    }
  }
  const firstWord = vehicleModel.trim().split(/\s+/)[0];
  return firstWord ? firstWord.charAt(0).toUpperCase() + firstWord.slice(1) : '';
}
