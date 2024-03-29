class Title < ApplicationRecord
  has_and_belongs_to_many :functions, inverse_of: :titles
  has_many :compositions, inverse_of: :title
  has_many :inclusions, through: :compositions

  LANGUAGES = %w[
    Catalan
    Dutch
    English
    French
    German
    Greek
    Italian
    Latin
    Spanish
    textless
  ].freeze

  enum language: LANGUAGES

  validates :text, presence: true, uniqueness: true
end
