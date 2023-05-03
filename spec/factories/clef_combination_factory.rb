FactoryBot.define do
  factory :clef_combination do
    trait :with_voicing do
      voicings { [association(:voicing)] }
    end
  end
end
