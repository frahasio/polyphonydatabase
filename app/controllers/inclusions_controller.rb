class InclusionsController < ApplicationController
  def index
    @grouped_inclusions = Inclusion.all.group_by do |inclusion|
      UniquePiece.find_or_initialize_by(
        title: inclusion&.piece&.title,
        composers: inclusion.composers.compact.map(&:id).join(","),
        minimum_voices: inclusion.minimum_voice_count,
      )
    end
  end
end
