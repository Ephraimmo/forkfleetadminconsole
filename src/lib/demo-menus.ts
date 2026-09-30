// Ready-made demo menus, so a restaurant can be shown (or tested) with a full
// menu in one click instead of typing it in on the Menus page.
//
// Every record has a fixed id (itm_demo_nonna_margherita, …), which makes
// loading safe to repeat: records already there are left alone, so edits made
// to demo products survive a second load, and "Remove" takes out exactly the
// records the demo added. Products the restaurant already has are never
// touched — a demo product with the same name as one of theirs is skipped, and
// a demo category with the same name as one of theirs is reused.

import { fsBatch, isFirebaseAvailable, type FsBatchWrite } from "@/lib/firestore";
import {
  getMenuForRestaurant,
  menuAddonDocument,
  menuCollectionPath,
  menuItemDocument,
  menuModifierDocument,
  menuVariantDocument,
  type MenuAddon,
  type MenuCategory,
  type MenuItem,
  type MenuModifier,
  type MenuPayload,
  type MenuVariant,
} from "@/lib/menus.firebase";

interface DemoModifier {
  key: string;
  name: string;
  type: "option" | "extra";
  required: boolean;
  include_pricing: boolean;
  min_selections: number;
  max_selections: number;
  /** [label, price] — the price only counts when the group is priced. */
  choices: [string, number][];
}

interface DemoProduct {
  key: string;
  name: string;
  description: string;
  price: number;
  sale_price?: number;
  prep_minutes: number;
  /** Unsplash photo id. */
  photo: string;
  allergens?: string[];
  featured?: boolean;
  /** Sizes as [name, extra price]; the first is the default. */
  variants?: [string, number][];
  /** Add-ons as [name, price] or [name, price, most a guest can add]. */
  addons?: [string, number, number?][];
  /** Keys of the modifier groups offered with this product. */
  modifiers?: string[];
}

interface DemoCategory {
  key: string;
  name: string;
  description: string;
  products: DemoProduct[];
}

export interface DemoMenu {
  /** Part of every record id, e.g. "nonna" → itm_demo_nonna_margherita. */
  key: string;
  restaurant_name: string;
  summary: string;
  categories: DemoCategory[];
  modifiers: DemoModifier[];
}

// --------------------------------------------------------- Nonna's Trattoria

const PIZZA_SIZES: [string, number][] = [
  ["Regular 30cm", 0],
  ["Large 40cm", 60],
];
const PIZZA_ADDONS: [string, number][] = [
  ["Extra fior di latte", 25],
  ["Parma ham", 45],
  ["Wild rocket", 15],
  ["Chilli oil", 10],
];
const PASTA_ADDONS: [string, number][] = [
  ["Extra Parmigiano", 15],
  ["Grilled chicken", 40],
  ["Fresh chilli", 8],
];
const COFFEE_SIZES: [string, number][] = [
  ["Regular", 0],
  ["Large", 8],
];
const wineSizes = (bottleExtra: number): [string, number][] => [
  ["Glass", 0],
  ["Bottle 750ml", bottleExtra],
];

const NONNA: DemoMenu = {
  key: "nonna",
  restaurant_name: "Nonna's Trattoria",
  summary:
    "A full Italian trattoria menu: antipasti, wood-fired pizza, fresh pasta, mains, sides, desserts, a kids' menu, coffee and soft drinks, and wine and cocktails.",
  modifiers: [
    {
      key: "pizza_base",
      name: "Pizza base",
      type: "option",
      required: true,
      include_pricing: true,
      min_selections: 1,
      max_selections: 1,
      choices: [
        ["Classic Neapolitan", 0],
        ["Thin & crispy", 0],
        ["Gluten-free", 35],
      ],
    },
    {
      key: "pasta_shape",
      name: "Pasta shape",
      type: "option",
      required: true,
      include_pricing: true,
      min_selections: 1,
      max_selections: 1,
      choices: [
        ["Spaghetti", 0],
        ["Penne", 0],
        ["Tagliatelle", 0],
        ["Gluten-free penne", 25],
      ],
    },
    {
      key: "steak_cooking",
      name: "Steak cooking",
      type: "option",
      required: true,
      include_pricing: false,
      min_selections: 1,
      max_selections: 1,
      choices: [
        ["Rare", 0],
        ["Medium rare", 0],
        ["Medium", 0],
        ["Medium well", 0],
        ["Well done", 0],
      ],
    },
    {
      key: "side",
      name: "Side",
      type: "option",
      required: true,
      include_pricing: false,
      min_selections: 1,
      max_selections: 1,
      choices: [
        ["Hand-cut chips", 0],
        ["Truffle & Parmesan fries", 0],
        ["Rocket & Parmesan salad", 0],
        ["Insalata mista", 0],
      ],
    },
    {
      key: "steak_sauce",
      name: "Steak sauce",
      type: "extra",
      required: false,
      include_pricing: true,
      min_selections: 0,
      max_selections: 2,
      choices: [
        ["Green peppercorn", 30],
        ["Porcini mushroom", 30],
        ["Gorgonzola", 35],
        ["Salsa verde", 25],
      ],
    },
    {
      key: "gelato_flavours",
      name: "Gelato flavours",
      type: "extra",
      required: true,
      include_pricing: false,
      min_selections: 1,
      max_selections: 3,
      choices: [
        ["Vanilla bean", 0],
        ["Dark chocolate", 0],
        ["Pistachio", 0],
        ["Stracciatella", 0],
        ["Lemon sorbetto", 0],
      ],
    },
    {
      key: "milk",
      name: "Milk",
      type: "option",
      required: true,
      include_pricing: true,
      min_selections: 1,
      max_selections: 1,
      choices: [
        ["Full cream", 0],
        ["Low fat", 0],
        ["Oat", 8],
        ["Almond", 8],
      ],
    },
  ],
  categories: [
    {
      key: "antipasti",
      name: "Antipasti",
      description: "Small plates to start and to share.",
      products: [
        {
          key: "pane_di_casa",
          name: "Pane di Casa",
          description: "House sourdough, whipped butter, olive oil and aged balsamic.",
          price: 55,
          prep_minutes: 5,
          photo: "photo-1586444248902-2f64eddc13df",
          allergens: ["Gluten", "Dairy"],
        },
        {
          key: "focaccia",
          name: "Garlic & Rosemary Focaccia",
          description: "Warm focaccia from the wood oven, garlic butter, rosemary and sea salt.",
          price: 65,
          prep_minutes: 8,
          photo: "photo-1573140401552-3fab0b24306f",
          allergens: ["Gluten", "Dairy"],
          addons: [["Melted mozzarella", 25, 1]],
        },
        {
          key: "bruschetta",
          name: "Bruschetta al Pomodoro",
          description: "Grilled ciabatta, vine tomatoes, garlic, basil and extra virgin olive oil.",
          price: 85,
          prep_minutes: 8,
          photo: "photo-1572695157366-5e585ab2b69f",
          allergens: ["Gluten"],
          addons: [["Buffalo mozzarella", 35, 1]],
        },
        {
          key: "tagliere_misto",
          name: "Tagliere Misto",
          description:
            "Antipasto board: Parma ham, salame Milano, mortadella, Grana Padano, gorgonzola, olives, pickles and grissini.",
          price: 245,
          prep_minutes: 10,
          photo: "photo-1541529086526-db283c563270",
          allergens: ["Gluten", "Dairy", "Sulphites"],
          featured: true,
          variants: [
            ["For 2", 0],
            ["For 4", 190],
          ],
        },
        {
          key: "polpette",
          name: "Polpette al Sugo",
          description:
            "Nonna's beef and pork meatballs in slow-cooked tomato sugo, Grana Padano and toasted ciabatta.",
          price: 105,
          prep_minutes: 12,
          photo: "photo-1515516969-d4008cc6241a",
          allergens: ["Gluten", "Dairy", "Egg"],
        },
        {
          key: "caprese",
          name: "Insalata Caprese",
          description: "Heirloom tomatoes, fior di latte, fresh basil and extra virgin olive oil.",
          price: 110,
          prep_minutes: 6,
          photo: "photo-1592417817098-8fd3d9eb14a5",
          allergens: ["Dairy"],
        },
        {
          key: "zuppa_pomodoro",
          name: "Zuppa di Pomodoro",
          description: "Roast tomato and basil soup, crème fraîche and focaccia croutons.",
          price: 80,
          prep_minutes: 8,
          photo: "photo-1547592166-23ac45744acd",
          allergens: ["Gluten", "Dairy"],
        },
      ],
    },
    {
      key: "pizze",
      name: "Pizze",
      description: "Wood-fired, from dough rested for 48 hours.",
      products: [
        {
          key: "margherita",
          name: "Margherita",
          description: "San Marzano tomato, fior di latte, fresh basil and olive oil.",
          price: 115,
          prep_minutes: 14,
          photo: "photo-1574071318508-1cdbab80d002",
          allergens: ["Gluten", "Dairy"],
          featured: true,
          variants: PIZZA_SIZES,
          addons: PIZZA_ADDONS,
          modifiers: ["pizza_base"],
        },
        {
          key: "diavola",
          name: "Diavola",
          description: "Tomato, fior di latte, spicy salame, fresh chilli and oregano.",
          price: 145,
          prep_minutes: 14,
          photo: "photo-1628840042765-356cda07504e",
          allergens: ["Gluten", "Dairy"],
          variants: PIZZA_SIZES,
          addons: PIZZA_ADDONS,
          modifiers: ["pizza_base"],
        },
        {
          key: "prosciutto_rucola",
          name: "Prosciutto e Rucola",
          description: "Tomato, fior di latte, Parma ham, wild rocket and shaved Grana Padano.",
          price: 165,
          prep_minutes: 14,
          photo: "photo-1600628421055-4d30de868b8f",
          allergens: ["Gluten", "Dairy"],
          variants: PIZZA_SIZES,
          addons: PIZZA_ADDONS,
          modifiers: ["pizza_base"],
        },
        {
          key: "quattro_formaggi",
          name: "Quattro Formaggi",
          description: "White base, fior di latte, gorgonzola, provolone and Parmigiano.",
          price: 155,
          prep_minutes: 14,
          photo: "photo-1600028068383-ea11a7a101f3",
          allergens: ["Gluten", "Dairy"],
          variants: PIZZA_SIZES,
          addons: PIZZA_ADDONS,
          modifiers: ["pizza_base"],
        },
        {
          key: "capricciosa",
          name: "Capricciosa",
          description: "Tomato, fior di latte, ham, mushrooms, artichokes and black olives.",
          price: 150,
          prep_minutes: 14,
          photo: "photo-1513104890138-7c749659a591",
          allergens: ["Gluten", "Dairy"],
          variants: PIZZA_SIZES,
          addons: PIZZA_ADDONS,
          modifiers: ["pizza_base"],
        },
        {
          key: "spinaci_ricotta",
          name: "Spinaci e Ricotta",
          description: "White base, baby spinach, ricotta, garlic, fior di latte and lemon zest.",
          price: 140,
          prep_minutes: 14,
          photo: "photo-1593560708920-61dd98c46a4e",
          allergens: ["Gluten", "Dairy"],
          variants: PIZZA_SIZES,
          addons: PIZZA_ADDONS,
          modifiers: ["pizza_base"],
        },
        {
          key: "vegetariana",
          name: "Vegetariana",
          description:
            "Tomato, fior di latte, roast peppers, courgette, aubergine, red onion and olives.",
          price: 135,
          sale_price: 115,
          prep_minutes: 14,
          photo: "photo-1590947132387-155cc02f3212",
          allergens: ["Gluten", "Dairy"],
          variants: PIZZA_SIZES,
          addons: PIZZA_ADDONS,
          modifiers: ["pizza_base"],
        },
        {
          key: "nonnas_special",
          name: "Nonna's Special",
          description:
            "Tomato, fior di latte, Italian pork sausage, roast peppers, chilli and basil.",
          price: 175,
          prep_minutes: 15,
          photo: "photo-1585238342024-78d387f4a707",
          allergens: ["Gluten", "Dairy"],
          featured: true,
          variants: PIZZA_SIZES,
          addons: PIZZA_ADDONS,
          modifiers: ["pizza_base"],
        },
      ],
    },
    {
      key: "pasta",
      name: "Pasta & Risotto",
      description: "Pasta made fresh every morning.",
      products: [
        {
          key: "carbonara",
          name: "Spaghetti Carbonara",
          description:
            "Guanciale, egg yolk, Pecorino Romano and black pepper — no cream, the Roman way.",
          price: 145,
          prep_minutes: 15,
          photo: "photo-1579631542720-3a87824fff86",
          allergens: ["Gluten", "Dairy", "Egg"],
          featured: true,
          addons: PASTA_ADDONS,
          modifiers: ["pasta_shape"],
        },
        {
          key: "pomodoro",
          name: "Spaghetti al Pomodoro",
          description: "Cherry tomatoes, garlic, fresh basil and extra virgin olive oil.",
          price: 110,
          prep_minutes: 12,
          photo: "photo-1626844131082-256783844137",
          allergens: ["Gluten"],
          addons: PASTA_ADDONS,
          modifiers: ["pasta_shape"],
        },
        {
          key: "arrabbiata",
          name: "Penne all'Arrabbiata",
          description: "Fiery tomato, garlic and chilli sauce with flat-leaf parsley.",
          price: 115,
          prep_minutes: 12,
          photo: "photo-1621996346565-e3dbc646d9a9",
          allergens: ["Gluten"],
          addons: PASTA_ADDONS,
          modifiers: ["pasta_shape"],
        },
        {
          key: "ragu",
          name: "Tagliatelle al Ragù",
          description: "Nonna's slow-cooked beef and pork ragù with Parmigiano Reggiano.",
          price: 150,
          prep_minutes: 15,
          photo: "photo-1600803907087-f56d462fd26b",
          allergens: ["Gluten", "Dairy", "Egg", "Celery"],
          addons: PASTA_ADDONS,
          modifiers: ["pasta_shape"],
        },
        {
          key: "lasagne",
          name: "Lasagne della Nonna",
          description: "Layers of fresh pasta, ragù, béchamel and Parmigiano, baked every day.",
          price: 155,
          prep_minutes: 18,
          photo: "photo-1619895092538-128341789043",
          allergens: ["Gluten", "Dairy", "Egg", "Celery"],
          featured: true,
        },
        {
          key: "ravioli",
          name: "Ravioli Ricotta e Spinaci",
          description: "Ricotta and spinach ravioli, sage brown butter and toasted pine nuts.",
          price: 145,
          prep_minutes: 14,
          photo: "photo-1587740908075-9e245070dfaa",
          allergens: ["Gluten", "Dairy", "Egg", "Tree nuts"],
        },
        {
          key: "gnocchi",
          name: "Gnocchi al Gorgonzola",
          description: "Potato gnocchi in a gorgonzola cream with toasted walnuts.",
          price: 140,
          prep_minutes: 14,
          photo: "photo-1662197480393-2a82030b7b83",
          allergens: ["Gluten", "Dairy", "Egg", "Tree nuts"],
        },
        {
          key: "pappardelle_funghi",
          name: "Pappardelle ai Funghi",
          description: "Wild mushrooms, garlic, thyme, white wine and a drizzle of truffle oil.",
          price: 150,
          prep_minutes: 15,
          photo: "photo-1611270629569-8b357cb88da9",
          allergens: ["Gluten", "Dairy", "Egg", "Sulphites"],
        },
        {
          key: "frutti_di_mare",
          name: "Linguine ai Frutti di Mare",
          description: "Prawns, mussels and calamari with cherry tomatoes, white wine and chilli.",
          price: 225,
          prep_minutes: 18,
          photo: "photo-1563379926898-05f4575a45d8",
          allergens: ["Gluten", "Shellfish", "Molluscs", "Sulphites"],
        },
        {
          key: "vongole",
          name: "Spaghetti alle Vongole",
          description: "Fresh clams, garlic, white wine, parsley and a little chilli.",
          price: 195,
          prep_minutes: 16,
          photo: "photo-1595295333158-4742f28fbd85",
          allergens: ["Gluten", "Molluscs", "Sulphites"],
        },
        {
          key: "risotto_porcini",
          name: "Risotto ai Funghi Porcini",
          description: "Carnaroli rice, porcini mushrooms, butter and Parmigiano Reggiano.",
          price: 165,
          prep_minutes: 22,
          photo: "photo-1476124369491-e7addf5db371",
          allergens: ["Dairy", "Sulphites"],
        },
      ],
    },
    {
      key: "secondi",
      name: "Secondi",
      description: "Mains from the grill and the oven.",
      products: [
        {
          key: "bistecca",
          name: "Bistecca alla Griglia",
          description: "Aged sirloin from the grill with rosemary and garlic butter.",
          price: 245,
          prep_minutes: 25,
          photo: "photo-1600891964092-4316c288032e",
          allergens: ["Dairy"],
          featured: true,
          variants: [
            ["300g", 0],
            ["450g", 95],
          ],
          modifiers: ["steak_cooking", "side", "steak_sauce"],
        },
        {
          key: "tagliata",
          name: "Tagliata di Manzo",
          description:
            "Sliced rump on wild rocket with cherry tomatoes, Grana Padano and balsamic.",
          price: 235,
          prep_minutes: 22,
          photo: "photo-1504674900247-0877df9cc836",
          allergens: ["Dairy"],
          modifiers: ["steak_cooking"],
        },
        {
          key: "pollo_parmigiana",
          name: "Pollo alla Parmigiana",
          description: "Crumbed chicken breast baked with tomato sugo and melted mozzarella.",
          price: 175,
          prep_minutes: 22,
          photo: "photo-1632778149955-e80f8ceca2e8",
          allergens: ["Gluten", "Dairy", "Egg"],
          modifiers: ["side"],
        },
        {
          key: "pollo_fiorentina",
          name: "Pollo alla Fiorentina",
          description:
            "Pan-roasted chicken breast in a creamy spinach, garlic and Parmigiano sauce.",
          price: 180,
          prep_minutes: 22,
          photo: "photo-1485921325833-c519f76c4927",
          allergens: ["Dairy"],
          modifiers: ["side"],
        },
        {
          key: "salmone",
          name: "Salmone alla Griglia",
          description: "Grilled salmon fillet with salsa verde and charred lemon.",
          price: 265,
          prep_minutes: 20,
          photo: "photo-1519708227418-c8fd9a32b7a2",
          allergens: ["Fish"],
          modifiers: ["side"],
        },
        {
          key: "pesce_del_giorno",
          name: "Pesce del Giorno",
          description:
            "Today's line fish, grilled whole with lemon, capers and olive oil. Ask your waiter for today's catch.",
          price: 235,
          prep_minutes: 25,
          photo: "photo-1611171711912-e3f6b536f532",
          allergens: ["Fish"],
          modifiers: ["side"],
        },
        {
          key: "grigliata_di_mare",
          name: "Grigliata di Mare",
          description: "Grilled octopus, king prawns and calamari with lemon and herb butter.",
          price: 325,
          prep_minutes: 25,
          photo: "photo-1606850780554-b55ea4dd0b70",
          allergens: ["Shellfish", "Molluscs", "Dairy"],
        },
        {
          key: "melanzane",
          name: "Melanzane alla Parmigiana",
          description:
            "Layers of aubergine, tomato, basil, mozzarella and Parmigiano, baked until golden.",
          price: 150,
          prep_minutes: 18,
          photo: "photo-1629115916087-7e8c114a24ed",
          allergens: ["Dairy"],
        },
      ],
    },
    {
      key: "contorni",
      name: "Contorni",
      description: "Sides.",
      products: [
        {
          key: "chips",
          name: "Hand-cut Chips",
          description: "Crisp hand-cut potato chips with sea salt.",
          price: 40,
          prep_minutes: 8,
          photo: "photo-1630384060421-cb20d0e0649d",
        },
        {
          key: "truffle_fries",
          name: "Truffle & Parmesan Fries",
          description: "Fries tossed in truffle oil, Parmigiano and parsley.",
          price: 60,
          prep_minutes: 8,
          photo: "photo-1573080496219-bb080dd4f877",
          allergens: ["Dairy"],
        },
        {
          key: "rocket_salad",
          name: "Rocket & Parmesan Salad",
          description: "Wild rocket, shaved Parmigiano, lemon and olive oil.",
          price: 55,
          prep_minutes: 5,
          photo: "photo-1608032077018-c9aad9565d29",
          allergens: ["Dairy"],
        },
        {
          key: "insalata_mista",
          name: "Insalata Mista",
          description: "Mixed leaves, tomato, cucumber, red onion and house vinaigrette.",
          price: 50,
          prep_minutes: 5,
          photo: "photo-1505253716362-afaea1d3d1af",
          allergens: ["Mustard"],
        },
      ],
    },
    {
      key: "dolci",
      name: "Dolci",
      description: "Desserts, made in house.",
      products: [
        {
          key: "tiramisu",
          name: "Tiramisù della Nonna",
          description: "Mascarpone cream, espresso-soaked savoiardi and cocoa.",
          price: 85,
          prep_minutes: 5,
          photo: "photo-1631206753348-db44968fd440",
          allergens: ["Gluten", "Dairy", "Egg"],
          featured: true,
        },
        {
          key: "panna_cotta",
          name: "Panna Cotta ai Frutti di Bosco",
          description: "Vanilla panna cotta with a forest berry compote.",
          price: 75,
          prep_minutes: 5,
          photo: "photo-1488477181946-6428a0291777",
          allergens: ["Dairy"],
        },
        {
          key: "torta_caprese",
          name: "Torta Caprese",
          description: "Flourless dark chocolate and almond cake with vanilla gelato.",
          price: 80,
          prep_minutes: 5,
          photo: "photo-1578985545062-69928b1d9587",
          allergens: ["Dairy", "Egg", "Tree nuts"],
        },
        {
          key: "gelato",
          name: "Gelato Artigianale",
          description: "House-churned gelato — choose your flavours.",
          price: 60,
          prep_minutes: 3,
          photo: "photo-1567206563064-6f60f40a2b57",
          allergens: ["Dairy"],
          variants: [
            ["Two scoops", 0],
            ["Three scoops", 25],
          ],
          modifiers: ["gelato_flavours"],
        },
        {
          key: "affogato",
          name: "Affogato al Caffè",
          description: "Vanilla gelato drowned in a double espresso.",
          price: 55,
          prep_minutes: 3,
          photo: "photo-1586195831800-24f14c992cea",
          allergens: ["Dairy"],
          addons: [
            ["Shot of Amaretto", 35, 1],
            ["Shot of Frangelico", 35, 1],
          ],
        },
      ],
    },
    {
      key: "bambini",
      name: "Bambini",
      description: "For guests under 12.",
      products: [
        {
          key: "kids_margherita",
          name: "Kids' Margherita",
          description: "A 20cm Margherita with tomato and mozzarella.",
          price: 75,
          prep_minutes: 12,
          photo: "photo-1595854341625-f33ee10dbf94",
          allergens: ["Gluten", "Dairy"],
        },
        {
          key: "kids_pomodoro",
          name: "Kids' Spaghetti Pomodoro",
          description: "Spaghetti in a mild tomato sauce.",
          price: 65,
          prep_minutes: 10,
          photo: "photo-1598866594230-a7c12756260f",
          allergens: ["Gluten"],
        },
        {
          key: "kids_bolognese",
          name: "Kids' Spaghetti Bolognese",
          description: "Spaghetti with Nonna's ragù and a little Parmigiano.",
          price: 70,
          prep_minutes: 10,
          photo: "photo-1622973536968-3ead9e780960",
          allergens: ["Gluten", "Dairy", "Celery"],
        },
        {
          key: "kids_cotoletta",
          name: "Kids' Chicken Cotoletta & Chips",
          description: "Crumbed chicken pieces with chips and tomato sauce.",
          price: 75,
          prep_minutes: 12,
          photo: "photo-1580217593608-61931cefc821",
          allergens: ["Gluten", "Egg"],
        },
      ],
    },
    {
      key: "bevande",
      name: "Caffè & Bevande",
      description: "Coffee, soft drinks, juices and water.",
      products: [
        {
          key: "espresso",
          name: "Espresso",
          description: "Our Italian roast, pulled short.",
          price: 28,
          prep_minutes: 3,
          photo: "photo-1510591509098-f4fdc6d0ff04",
          variants: [
            ["Single", 0],
            ["Double", 10],
          ],
        },
        {
          key: "americano",
          name: "Americano",
          description: "Espresso topped up with hot water.",
          price: 32,
          prep_minutes: 3,
          photo: "photo-1514432324607-a09d9b4aefdd",
        },
        {
          key: "cappuccino",
          name: "Cappuccino",
          description: "Espresso with steamed milk and a deep layer of foam.",
          price: 38,
          prep_minutes: 4,
          photo: "photo-1572442388796-11668a67e53d",
          allergens: ["Dairy"],
          variants: COFFEE_SIZES,
          modifiers: ["milk"],
        },
        {
          key: "latte",
          name: "Caffè Latte",
          description: "Espresso with plenty of steamed milk.",
          price: 40,
          prep_minutes: 4,
          photo: "photo-1570968915860-54d5c301fa9f",
          allergens: ["Dairy"],
          variants: COFFEE_SIZES,
          modifiers: ["milk"],
        },
        {
          key: "iced_latte",
          name: "Iced Latte",
          description: "Double espresso over ice with cold milk.",
          price: 45,
          prep_minutes: 4,
          photo: "photo-1461023058943-07fcbe16d735",
          allergens: ["Dairy"],
          modifiers: ["milk"],
        },
        {
          key: "lemonade",
          name: "Homemade Lemonade",
          description: "Fresh lemons, mint and a little sugar.",
          price: 45,
          prep_minutes: 3,
          photo: "photo-1621263764928-df1444c5e859",
        },
        {
          key: "strawberry_soda",
          name: "Strawberry Italian Soda",
          description: "Strawberry syrup, sparkling water and fresh lime.",
          price: 45,
          prep_minutes: 3,
          photo: "photo-1497534446932-c925b458314e",
        },
        {
          key: "orange_juice",
          name: "Fresh Orange Juice",
          description: "Squeezed to order.",
          price: 42,
          prep_minutes: 3,
          photo: "photo-1600271886742-f049cd451bba",
        },
        {
          key: "peach_iced_tea",
          name: "Peach Iced Tea",
          description: "Brewed in house and served over ice.",
          price: 38,
          prep_minutes: 2,
          photo: "photo-1560023907-5f339617ea30",
        },
        {
          key: "soft_drink",
          name: "Soft Drink",
          description: "A 330ml can, served with ice and lemon.",
          price: 30,
          prep_minutes: 1,
          photo: "photo-1554866585-cd94860890b7",
          variants: [
            ["Coca-Cola", 0],
            ["Coca-Cola Zero", 0],
            ["Sprite", 0],
            ["Fanta Orange", 0],
          ],
        },
        {
          key: "sparkling_water",
          name: "Sparkling Water",
          description: "San Pellegrino sparkling mineral water.",
          price: 30,
          prep_minutes: 1,
          photo: "photo-1551538827-9c037cb4f32a",
          variants: [
            ["250ml", 0],
            ["750ml", 22],
          ],
        },
        {
          key: "still_water",
          name: "Still Water",
          description: "Still mineral water.",
          price: 28,
          prep_minutes: 1,
          photo: "photo-1523362628745-0c100150b504",
          variants: [
            ["500ml", 0],
            ["1 litre", 15],
          ],
        },
      ],
    },
    {
      key: "vini",
      name: "Vini & Cocktails",
      description: "Wine, beer and aperitivi — over 18s only.",
      products: [
        {
          key: "chianti",
          name: "Chianti Classico DOCG",
          description: "Tuscany. Cherry, violets and soft tannins.",
          price: 85,
          prep_minutes: 2,
          photo: "photo-1474722883778-792e7990302f",
          allergens: ["Sulphites"],
          variants: wineSizes(245),
        },
        {
          key: "house_red",
          name: "Nonna's House Red",
          description: "Primitivo from Puglia. Ripe plum and a little spice.",
          price: 65,
          prep_minutes: 2,
          photo: "photo-1553361371-9b22f78e8b1d",
          allergens: ["Sulphites"],
          variants: wineSizes(185),
        },
        {
          key: "pinot_grigio",
          name: "Pinot Grigio delle Venezie",
          description: "Crisp and dry with pear and citrus.",
          price: 75,
          prep_minutes: 2,
          photo: "photo-1566995541428-f2246c17cda1",
          allergens: ["Sulphites"],
          variants: wineSizes(210),
        },
        {
          key: "rosato",
          name: "Salento Rosato",
          description: "Dry rosé from Puglia. Strawberry and watermelon.",
          price: 70,
          prep_minutes: 2,
          photo: "photo-1547595628-c61a29f496f0",
          allergens: ["Sulphites"],
          variants: wineSizes(195),
        },
        {
          key: "prosecco",
          name: "Prosecco DOC",
          description: "Dry, with fine bubbles and green apple.",
          price: 80,
          prep_minutes: 2,
          photo: "photo-1437418747212-8d9709afab22",
          allergens: ["Sulphites"],
          variants: wineSizes(270),
        },
        {
          key: "aperol_spritz",
          name: "Aperol Spritz",
          description: "Aperol, Prosecco, soda and a slice of orange.",
          price: 95,
          prep_minutes: 3,
          photo: "photo-1560512823-829485b8bf24",
          allergens: ["Sulphites"],
        },
        {
          key: "limoncello_spritz",
          name: "Limoncello Spritz",
          description: "House limoncello, Prosecco, soda and fresh mint.",
          price: 95,
          prep_minutes: 3,
          photo: "photo-1523371054106-bbf80586c38c",
          allergens: ["Sulphites"],
        },
        {
          key: "negroni",
          name: "Negroni",
          description: "Gin, Campari and sweet vermouth, stirred over ice.",
          price: 105,
          prep_minutes: 3,
          photo: "photo-1582106245687-cbb466a9f07f",
          allergens: ["Sulphites"],
        },
        {
          key: "limoncello",
          name: "Limoncello",
          description: "Made in house from Amalfi lemons and served ice cold.",
          price: 45,
          prep_minutes: 1,
          photo: "photo-1568569350062-ebfa3cb195df",
        },
        {
          key: "peroni",
          name: "Peroni Nastro Azzurro",
          description: "Crisp Italian lager, 330ml.",
          price: 45,
          prep_minutes: 1,
          photo: "photo-1608270586620-248524c67de9",
          allergens: ["Gluten"],
        },
      ],
    },
  ],
};

const DEMO_MENUS: Record<string, DemoMenu> = {
  "rst-nonna": NONNA,
};

/** The demo menu made for a restaurant, or null when it has none. */
export function demoMenuFor(restaurantId: string): DemoMenu | null {
  return DEMO_MENUS[restaurantId] ?? null;
}

// ----------------------------------------------------------- building records

const slug = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export function demoPhotoUrl(photoId: string): string {
  return `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=700&q=70`;
}

/** The demo as the menu records it adds (with its fixed ids). */
export function buildDemoMenu(demo: DemoMenu, restaurantId: string): MenuPayload {
  const id = (prefix: string, ...parts: string[]) =>
    [prefix, "demo", demo.key, ...parts.map(slug)].join("_");

  const modifiers: MenuModifier[] = demo.modifiers.map((m, index) => ({
    id: id("mod", m.key),
    restaurant_id: restaurantId,
    name: m.name,
    type: m.type,
    required: m.required,
    include_pricing: m.include_pricing,
    min_selections: m.min_selections,
    max_selections: m.max_selections,
    choices: m.choices.map(([label, price]) => ({
      label,
      price: m.include_pricing ? price : 0,
    })),
    sort_order: index,
    is_available: true,
  }));
  const modifierByKey = new Map(demo.modifiers.map((m, i) => [m.key, modifiers[i]!]));

  const categories: MenuCategory[] = [];
  const items: MenuItem[] = [];
  const variants: MenuVariant[] = [];
  const addons: MenuAddon[] = [];

  demo.categories.forEach((cat, catIndex) => {
    const categoryId = id("cat", cat.key);
    categories.push({
      id: categoryId,
      restaurant_id: restaurantId,
      name: cat.name,
      description: cat.description,
      sort_order: catIndex,
      is_available: true,
    });

    for (const p of cat.products) {
      const itemId = id("itm", p.key);
      const groups = (p.modifiers ?? []).map((key) => {
        const group = modifierByKey.get(key);
        if (!group) throw new Error(`${p.name} uses an unknown modifier group "${key}".`);
        return group;
      });
      items.push({
        id: itemId,
        restaurant_id: restaurantId,
        category_id: categoryId,
        category: cat.name,
        name: p.name,
        description: p.description,
        price: p.price,
        discount_price: p.sale_price ?? null,
        prep_time_minutes: p.prep_minutes,
        points_value: Math.max(1, Math.round(p.price / 20)),
        is_available: true,
        is_featured: p.featured === true,
        image_url: demoPhotoUrl(p.photo),
        allergens: p.allergens ?? [],
        // Every choice of each group is ticked for the product, at the group's price.
        modifier_ids: groups.map((g) => g.id),
        modifier_config: Object.fromEntries(
          groups.map((g) => [
            g.id,
            Object.fromEntries(
              g.choices.map((c, i) => [String(i), { selected: true, price: c.price }]),
            ),
          ]),
        ),
      });
      (p.variants ?? []).forEach(([name, delta], index) => {
        variants.push({
          id: id("var", p.key, name),
          menu_item_id: itemId,
          name,
          price_delta: delta,
          is_default: index === 0,
          is_available: true,
          sort_order: index,
        });
      });
      for (const [name, price, max] of p.addons ?? []) {
        addons.push({
          id: id("add", p.key, name),
          menu_item_id: itemId,
          name,
          price,
          max_quantity: max ?? 3,
          is_available: true,
        });
      }
    }
  });

  return { categories, items, variants, addons, modifiers };
}

// ------------------------------------------------------------ load and remove

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface DemoMenuLoadPlan {
  /** The records this load writes. */
  add: MenuPayload;
  /** Demo products left out because the menu already has a product with that name. */
  skipped: string[];
  /** Demo products already on the menu from an earlier load. */
  already_loaded: number;
}

/**
 * What loading the demo into the current menu would write. Nothing the menu
 * already has is changed: records from an earlier load are left as they are
 * (including any edits), a demo category whose name the menu already uses is
 * reused rather than duplicated, and a demo product whose name the menu
 * already has is skipped, along with its sizes and add-ons.
 */
export function planDemoMenuLoad(demo: MenuPayload, current: MenuPayload): DemoMenuLoadPlan {
  const has = (list: { id: string }[]) => new Set(list.map((r) => r.id));
  const currentCategories = has(current.categories);
  const currentItems = has(current.items);
  const currentVariants = has(current.variants);
  const currentAddons = has(current.addons);
  const currentModifiers = has(current.modifiers);

  // Where each demo category's products go: the demo category, or one of the menu's own.
  const categoryFor = new Map<string, { id: string; name: string }>();
  const categories: MenuCategory[] = [];
  const nextSort =
    current.categories.length === 0
      ? 0
      : Math.max(...current.categories.map((c) => Number(c.sort_order) || 0)) + 1;
  for (const cat of demo.categories) {
    const existing = currentCategories.has(cat.id)
      ? current.categories.find((c) => c.id === cat.id)
      : current.categories.find((c) => sameName(c.name, cat.name));
    if (existing) {
      categoryFor.set(cat.id, { id: existing.id, name: existing.name });
      continue;
    }
    categoryFor.set(cat.id, { id: cat.id, name: cat.name });
    categories.push({ ...cat, sort_order: nextSort + cat.sort_order });
  }

  const items: MenuItem[] = [];
  const skipped: string[] = [];
  let alreadyLoaded = 0;
  for (const item of demo.items) {
    if (currentItems.has(item.id)) {
      alreadyLoaded += 1;
      continue;
    }
    if (current.items.some((i) => sameName(i.name, item.name))) {
      skipped.push(item.name);
      continue;
    }
    const category = categoryFor.get(item.category_id ?? "");
    items.push({
      ...item,
      category_id: category?.id ?? item.category_id,
      category: category?.name ?? item.category,
    });
  }

  // Sizes and add-ons come with a product the first time only, so ones an admin
  // deleted from a demo product don't reappear on the next load.
  const added = has(items);
  const variants = demo.variants.filter(
    (v) => added.has(v.menu_item_id) && !currentVariants.has(v.id),
  );
  const addons = demo.addons.filter((a) => added.has(a.menu_item_id) && !currentAddons.has(a.id));
  const modifiers = demo.modifiers.filter((m) => !currentModifiers.has(m.id));

  return {
    add: { categories, items, variants, addons, modifiers },
    skipped,
    already_loaded: alreadyLoaded,
  };
}

export interface DemoMenuRemovalPlan {
  remove: {
    categories: string[];
    items: string[];
    variants: string[];
    addons: string[];
    modifiers: string[];
  };
  /** The menu's own products that sat in a demo category; they become uncategorised. */
  uncategorise: string[];
}

/**
 * What removing the demo would delete: every demo record still on the menu,
 * plus any sizes and add-ons someone added to a demo product. The menu's own
 * products stay; any that were moved into a demo category become uncategorised,
 * as when a category is deleted on the Menus page.
 */
export function planDemoMenuRemoval(demo: MenuPayload, current: MenuPayload): DemoMenuRemovalPlan {
  const ids = (list: { id: string }[]) => new Set(list.map((r) => r.id));
  const demoCategories = ids(demo.categories);
  const demoItems = ids(demo.items);
  const demoVariants = ids(demo.variants);
  const demoAddons = ids(demo.addons);
  const demoModifiers = ids(demo.modifiers);

  const items = current.items.filter((i) => demoItems.has(i.id)).map((i) => i.id);
  const removedItems = new Set(items);
  return {
    remove: {
      categories: current.categories.filter((c) => demoCategories.has(c.id)).map((c) => c.id),
      items,
      variants: current.variants
        .filter((v) => demoVariants.has(v.id) || removedItems.has(v.menu_item_id))
        .map((v) => v.id),
      addons: current.addons
        .filter((a) => demoAddons.has(a.id) || removedItems.has(a.menu_item_id))
        .map((a) => a.id),
      modifiers: current.modifiers.filter((m) => demoModifiers.has(m.id)).map((m) => m.id),
    },
    uncategorise: current.items
      .filter((i) => !removedItems.has(i.id) && i.category_id && demoCategories.has(i.category_id))
      .map((i) => i.id),
  };
}

/** How many records a plan touches. */
export function demoPlanSize(plan: DemoMenuLoadPlan | DemoMenuRemovalPlan): number {
  const lists = "add" in plan ? Object.values(plan.add) : Object.values(plan.remove);
  const own = "uncategorise" in plan ? plan.uncategorise.length : 0;
  return lists.reduce((sum, list) => sum + list.length, own);
}

function requireDemo(restaurantId: string): DemoMenu {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const demo = demoMenuFor(restaurantId);
  if (!demo) throw new Error("There's no demo menu for this restaurant.");
  return demo;
}

/** Add the restaurant's demo menu to its live menu, in one atomic write. */
export async function loadDemoMenu(restaurantId: string): Promise<DemoMenuLoadPlan> {
  const demo = requireDemo(restaurantId);
  const current = await getMenuForRestaurant(restaurantId);
  const plan = planDemoMenuLoad(buildDemoMenu(demo, restaurantId), current);
  const path = (kind: Parameters<typeof menuCollectionPath>[1], id: string) =>
    `${menuCollectionPath(restaurantId, kind)}/${id}`;
  const writes: FsBatchWrite[] = [
    ...plan.add.categories.map((r) => ({
      kind: "set" as const,
      path: path("categories", r.id),
      value: r,
    })),
    ...plan.add.modifiers.map((r) => ({
      kind: "set" as const,
      path: path("modifiers", r.id),
      value: menuModifierDocument(r),
    })),
    ...plan.add.items.map((r) => ({
      kind: "set" as const,
      path: path("items", r.id),
      value: menuItemDocument(r),
    })),
    ...plan.add.variants.map((r) => ({
      kind: "set" as const,
      path: path("variants", r.id),
      value: menuVariantDocument(r),
    })),
    ...plan.add.addons.map((r) => ({
      kind: "set" as const,
      path: path("addons", r.id),
      value: menuAddonDocument(r),
    })),
  ];
  await fsBatch(writes);
  return plan;
}

/** Take the demo menu back off the restaurant's live menu, in one atomic write. */
export async function removeDemoMenu(restaurantId: string): Promise<DemoMenuRemovalPlan> {
  const demo = requireDemo(restaurantId);
  const current = await getMenuForRestaurant(restaurantId);
  const plan = planDemoMenuRemoval(buildDemoMenu(demo, restaurantId), current);
  const writes: FsBatchWrite[] = [
    ...(Object.entries(plan.remove) as [keyof DemoMenuRemovalPlan["remove"], string[]][]).flatMap(
      ([kind, list]) =>
        list.map((id) => ({
          kind: "delete" as const,
          path: `${menuCollectionPath(restaurantId, kind)}/${id}`,
        })),
    ),
    ...plan.uncategorise.map((id) => ({
      kind: "update" as const,
      path: `${menuCollectionPath(restaurantId, "items")}/${id}`,
      patch: { category_id: null },
    })),
  ];
  await fsBatch(writes);
  return plan;
}
