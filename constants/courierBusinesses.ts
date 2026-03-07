export interface CourierMenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
}

export interface CourierBusiness {
  id: string;
  name: string;
  city: string;
  district?: string;
  address: string;
  image: string;
  website?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  rating: number;
  reviewCount: number;
  deliveryTime: string;
  deliveryFee: number;
  minOrder: number;
  menu: CourierMenuItem[];
  isActive?: boolean;
  safetyPartner?: boolean;
  safetyLevel?: 1 | 2 | 3;
}

export function getCourierBusinessesByCity(city: string): CourierBusiness[] {
  return COURIER_BUSINESSES.filter(
    (b) => b.city.toLowerCase() === city.toLowerCase()
  );
}

export const COURIER_BUSINESSES: CourierBusiness[] = [
  {
    id: 'cb1',
    name: 'Öz Denizli Pide & Kebap',
    city: 'Denizli',
    safetyPartner: true,
    safetyLevel: 1,
    address: 'Bayramyeri Mah. 1520 Sk. No:12, Merkezefendi/Denizli',
    image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&q=80',
    rating: 4.7,
    reviewCount: 523,
    deliveryTime: '25-35 dk',
    deliveryFee: 15,
    minOrder: 60,
    menu: [
      {
        id: 'cb1_m1',
        name: 'Kuşbaşılı Pide',
        description: 'Taze fırın ekmeği üzerine kuşbaşı dana eti, kaşar peyniri',
        price: 140,
        image: 'https://images.unsplash.com/photo-1600628421060-939639517883?w=400&q=80',
      },
      {
        id: 'cb1_m2',
        name: 'Kıymalı Lahmacun (3 Adet)',
        description: 'İnce hamur, özel baharatlı kıyma harcı, maydanoz limon',
        price: 90,
        image: 'https://images.unsplash.com/photo-1633321702518-7fecdafb94d5?w=400&q=80',
      },
      {
        id: 'cb1_m3',
        name: 'Adana Kebap Porsiyon',
        description: 'El yapımı acılı kebap, lavaş, közlenmiş domates biber',
        price: 180,
        image: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=400&q=80',
      },
      {
        id: 'cb1_m4',
        name: 'Karışık Izgara',
        description: 'Adana, urfa, pirzola, kanat - pilav ve salata ile',
        price: 280,
        image: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&q=80',
      },
      {
        id: 'cb1_m5',
        name: 'Ayran (300ml)',
        description: 'Taze ev yapımı ayran',
        price: 20,
        image: 'https://images.unsplash.com/photo-1582106245687-cbb466a9f07f?w=400&q=80',
      },
      {
        id: 'cb1_m6',
        name: 'Künefe',
        description: 'Antep fıstıklı, sıcak servis künefe',
        price: 85,
        image: 'https://images.unsplash.com/photo-1576097449798-7c7f90e1248a?w=400&q=80',
      },
    ],
  },
  {
    id: 'cb2',
    name: 'Tatlıcı Usta - Denizli',
    city: 'Denizli',
    safetyPartner: true,
    safetyLevel: 2,
    address: 'Çınar Meydanı, Delikliçınar Mah., Merkezefendi/Denizli',
    image: 'https://images.unsplash.com/photo-1551024506-0bccd828d307?w=600&q=80',
    rating: 4.8,
    reviewCount: 387,
    deliveryTime: '20-30 dk',
    deliveryFee: 10,
    minOrder: 40,
    menu: [
      {
        id: 'cb2_m1',
        name: 'Fıstıklı Baklava (1 kg)',
        description: 'Antep fıstıklı, ince yufka, şerbetli',
        price: 350,
        image: 'https://images.unsplash.com/photo-1519676867240-f03562e64548?w=400&q=80',
      },
      {
        id: 'cb2_m2',
        name: 'Cevizli Baklava (1 kg)',
        description: 'Taze ceviz içli, geleneksel tarif',
        price: 280,
        image: 'https://images.unsplash.com/photo-1598110750624-207050c4f28c?w=400&q=80',
      },
      {
        id: 'cb2_m3',
        name: 'Sütlaç (Porsiyon)',
        description: 'Fırında sütlaç, tarçınlı',
        price: 55,
        image: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400&q=80',
      },
      {
        id: 'cb2_m4',
        name: 'Kazandibi (Porsiyon)',
        description: 'Geleneksel kazandibi, karamelize yüzey',
        price: 60,
        image: 'https://images.unsplash.com/photo-1571506165871-ee72a35bc9d4?w=400&q=80',
      },
      {
        id: 'cb2_m5',
        name: 'Trileçe',
        description: 'Üç sütlü kek, karamel soslu',
        price: 70,
        image: 'https://images.unsplash.com/photo-1571115177098-24ec42ed204d?w=400&q=80',
      },
      {
        id: 'cb2_m6',
        name: 'Türk Kahvesi',
        description: 'Geleneksel Türk kahvesi, lokumlu servis',
        price: 35,
        image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&q=80',
      },
    ],
  },
];
