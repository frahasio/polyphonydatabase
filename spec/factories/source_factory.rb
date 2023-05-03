FactoryBot.define do
  factory :source do
    sequence(:code) { |n| "SOURCE-#{n}" }
  end
end
