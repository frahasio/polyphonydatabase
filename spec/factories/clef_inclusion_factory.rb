FactoryBot.define do
  factory :clef_inclusion do
    association :inclusion

    clef { "c1" }
  end
end
