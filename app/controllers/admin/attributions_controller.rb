module Admin
  class AttributionsController < AdminControllerBase
    def index

    end

    def assign
      params[:attributions].each do |_, attribution|
        next if attribution[:id].blank?

        composer = Composer.find(params[:composer_id])

        if attribution[:id] == "on"
          attrib = Attribution.new(inclusion_id: attribution[:inclusion_id])
        else
          attrib = Attribution.find(attribution[:id])
        end

        success = true
        if !!params[:incorrectly_attributed]
          success = attrib.update_attributes(
            alias: nil,
            composer: composer,
            incorrectly_attributed: true,
          )
        else
          anonym = attrib.anonym || Anonym.find_or_initialize_by(name: "")
          composer_alias = Alias.find_or_create_by!(
            composer: composer,
            anonym: anonym,
          )

          success = composer_alias.persisted?

          success = attrib.update_attributes(
            anonym: nil,
            alias: composer_alias,
            composer: nil,
            incorrectly_attributed: false,
          )
        end

        unless success
          flash[:error] = (attrib.errors.full_messages + composer_alias.errors.full_messages).to_sentence
        end
      end

      redirect_to admin_attributions_path
    end
  end
end
