class CompositionType < ApplicationRecord
  has_many :compositions, inverse_of: :composition_type

  validates :name, presence: true, uniqueness: true
end
