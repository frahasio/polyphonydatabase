FactoryBot.define do
  factory :composition_type do
    sequence(:name) { |n| "Composition type #{n}" }
  end
end
