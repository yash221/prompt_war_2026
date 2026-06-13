/*
 * Recipe knowledge base for the cooking to-do planner.
 * All costs are per single serving, in INR. prep is total minutes for the dish.
 * diet: "vegan" dishes are also valid for "veg"; "veg" dishes are valid for "veg" and above.
 * tags drive substitution suggestions and cuisine filtering.
 */
const RECIPES = [
  // ---------- BREAKFAST ----------
  { id: "poha",        name: "Poha",                       meal: "breakfast", diet: "vegan", cuisine: "indian",   prep: 15, cost: 25,
    ingredients: ["Flattened rice 60g", "Onion 1/2", "Peanuts 15g", "Mustard seeds", "Turmeric", "Lemon"] },
  { id: "veg-upma",    name: "Vegetable Upma",             meal: "breakfast", diet: "vegan", cuisine: "indian",   prep: 20, cost: 28,
    ingredients: ["Semolina 60g", "Mixed veg 80g", "Mustard seeds", "Curry leaves", "Ginger"] },
  { id: "masala-omelette", name: "Masala Omelette + Toast", meal: "breakfast", diet: "egg",  cuisine: "indian",   prep: 12, cost: 40,
    ingredients: ["Eggs 2", "Bread 2 slices", "Onion 1/2", "Tomato 1/2", "Green chilli"] },
  { id: "oats-bowl",   name: "Banana Oats Bowl",           meal: "breakfast", diet: "veg",   cuisine: "continental", prep: 8, cost: 35,
    ingredients: ["Rolled oats 50g", "Milk 200ml", "Banana 1", "Honey", "Almonds 10g"] },
  { id: "tofu-scramble", name: "Tofu Scramble",            meal: "breakfast", diet: "vegan", cuisine: "continental", prep: 15, cost: 45,
    ingredients: ["Tofu 100g", "Bell pepper 1/2", "Turmeric", "Onion 1/2", "Spinach 30g"] },

  // ---------- LUNCH ----------
  { id: "dal-rice",    name: "Dal Tadka + Rice",           meal: "lunch", diet: "vegan", cuisine: "indian", prep: 35, cost: 45,
    ingredients: ["Toor dal 80g", "Rice 100g", "Onion 1", "Tomato 1", "Garlic", "Cumin"] },
  { id: "rajma",       name: "Rajma Chawal",               meal: "lunch", diet: "vegan", cuisine: "indian", prep: 45, cost: 55,
    ingredients: ["Kidney beans 100g", "Rice 100g", "Onion 1", "Tomato 2", "Ginger-garlic"] },
  { id: "paneer-roti", name: "Paneer Bhurji + Roti",       meal: "lunch", diet: "veg",   cuisine: "indian", prep: 30, cost: 70,
    ingredients: ["Paneer 100g", "Wheat flour 80g", "Onion 1", "Tomato 1", "Peas 30g"] },
  { id: "chicken-curry", name: "Chicken Curry + Rice",     meal: "lunch", diet: "nonveg", cuisine: "indian", prep: 50, cost: 95,
    ingredients: ["Chicken 150g", "Rice 100g", "Onion 2", "Tomato 1", "Ginger-garlic", "Spices"] },
  { id: "veg-fried-rice", name: "Veg Fried Rice",          meal: "lunch", diet: "vegan", cuisine: "asian", prep: 25, cost: 50,
    ingredients: ["Rice 100g", "Mixed veg 120g", "Soy sauce", "Spring onion", "Garlic"] },
  { id: "pasta-arrabiata", name: "Penne Arrabiata",        meal: "lunch", diet: "veg",   cuisine: "continental", prep: 25, cost: 65,
    ingredients: ["Penne 100g", "Tomato 3", "Garlic", "Chilli flakes", "Olive oil", "Basil"] },

  // ---------- DINNER ----------
  { id: "khichdi",     name: "Moong Dal Khichdi",          meal: "dinner", diet: "vegan", cuisine: "indian", prep: 30, cost: 40,
    ingredients: ["Moong dal 60g", "Rice 80g", "Mixed veg 80g", "Cumin", "Ginger"] },
  { id: "roti-sabzi",  name: "Aloo Gobi + Roti",           meal: "dinner", diet: "vegan", cuisine: "indian", prep: 35, cost: 45,
    ingredients: ["Potato 2", "Cauliflower 200g", "Wheat flour 80g", "Onion 1", "Turmeric"] },
  { id: "paneer-tikka-bowl", name: "Paneer Tikka Bowl",    meal: "dinner", diet: "veg",   cuisine: "indian", prep: 40, cost: 80,
    ingredients: ["Paneer 120g", "Yogurt 50g", "Bell pepper 1", "Onion 1", "Tikka spices", "Rice 80g"] },
  { id: "grilled-chicken", name: "Grilled Chicken + Salad", meal: "dinner", diet: "nonveg", cuisine: "continental", prep: 35, cost: 110,
    ingredients: ["Chicken breast 150g", "Lettuce", "Cucumber 1", "Tomato 1", "Olive oil", "Lemon"] },
  { id: "veg-stir-fry", name: "Tofu Veg Stir Fry + Noodles", meal: "dinner", diet: "vegan", cuisine: "asian", prep: 25, cost: 60,
    ingredients: ["Tofu 100g", "Noodles 100g", "Broccoli 80g", "Bell pepper 1", "Soy sauce", "Garlic"] },
  { id: "veg-soup",    name: "Clear Veg Soup + Garlic Bread", meal: "dinner", diet: "veg", cuisine: "continental", prep: 20, cost: 50,
    ingredients: ["Mixed veg 150g", "Bread 2 slices", "Garlic", "Butter", "Black pepper"] },
];

/*
 * Substitution rules: cheaper or diet-friendly swaps the engine can suggest.
 * Each rule: if an ingredient (matched loosely) appears, offer this swap with a note.
 */
const SUBSTITUTIONS = [
  { match: "paneer",  swap: "Tofu",                 note: "cheaper + vegan, similar protein" },
  { match: "chicken", swap: "Soya chunks / Rajma",  note: "much cheaper protein, vegetarian" },
  { match: "almond",  swap: "Peanuts",              note: "fraction of the cost, similar crunch" },
  { match: "olive oil", swap: "Refined / mustard oil", note: "everyday oil, far cheaper" },
  { match: "penne",   swap: "Local macaroni",       note: "cheaper, same dish" },
  { match: "honey",   swap: "Jaggery / sugar",      note: "cheaper sweetener" },
  { match: "tofu",    swap: "Paneer",               note: "if vegan is not required, easier to find" },
  { match: "milk",    swap: "Soy / oat milk",       note: "for a vegan swap" },
];
