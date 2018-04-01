class Function < ApplicationRecord
  has_and_belongs_to_many :titles, inverse_of: :functions
  has_many :compositions, through: :titles
  has_many :groups, through: :compositions
end
